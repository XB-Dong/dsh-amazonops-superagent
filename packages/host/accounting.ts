import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-agent';
import type { ModelBudget } from '../business/index.ts';

export type AccountingState = { live: boolean; stopped: boolean; activeRequests: number; lastSuccess?: string; lastFailure?: string; lastOutcome?:'succeeded'|'failed' };
export type AccountingOptions = { live?: boolean; maxRequestsPerTurn?: number; timeoutMs?: number; defaultOutputTokens?: number };
export type AccountingDisposer = (() => void) & { state: AccountingState; setLive(value: boolean): void };

function verifiedUsage(value: TokenUsage): { inputTokens: number; outputTokens: number } | undefined {
  const counts = [value.inputTokens, value.outputTokens,
    value.cacheReadTokens === undefined ? 0 : value.cacheReadTokens,
    value.cacheWriteTokens === undefined ? 0 : value.cacheWriteTokens];
  if (!counts.every(count => Number.isSafeInteger(count) && count >= 0)) return;
  const inputTokens = counts[0] + counts[2] + counts[3];
  const total = inputTokens + counts[1];
  if (!Number.isSafeInteger(total) || (value.totalTokens !== undefined && value.totalTokens !== total)) return;
  return { inputTokens, outputTokens: counts[1] };
}
function nextWithSignal<T>(next: () => Promise<T>, signal: AbortSignal, code: () => string): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(code()));
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error(code())); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(next).then(value => {
      signal.removeEventListener('abort', abort); resolve(value);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

export function installAccounting(ctx: Context, budget: ModelBudget, options: AccountingOptions = {}): AccountingDisposer {
  const timeoutMs = options.timeoutMs ?? 90000;
  const defaultOutputTokens = options.defaultOutputTokens ?? 1024;
  const maximumPerTurn = options.maxRequestsPerTurn;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647 ||
      !Number.isSafeInteger(defaultOutputTokens) || defaultOutputTokens < 1 ||
      (options.live !== undefined && typeof options.live !== 'boolean') ||
      (maximumPerTurn !== undefined && (!Number.isSafeInteger(maximumPerTurn) || maximumPerTurn < 1)))
    throw new Error('INVALID_ACCOUNTING_POLICY');
  const state: AccountingState = { live: options.live ?? false, stopped: false, activeRequests: 0 };
  const turns = new Map<string, number>();
  const stop = new AbortController();
  const pending = new Map<string, () => void>();
  budget.db.exec(`CREATE TABLE IF NOT EXISTS model_request_attribution (
    request_id TEXT PRIMARY KEY, session_id TEXT, turn_seq INTEGER,
    purpose TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL
  );`);
  const offEvents = ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') turns.set(session.id, Number(event.seq));
    if (event.type === 'turn/end') turns.delete(session.id);
  }, { global: true });
  const offStream = ctx.on('llm/stream', async function* (request, next) {
    let id: string | undefined;
    let settled = false;
    let terminal: string | undefined;
    let complete = false;
    let failed = false;
    let usage: ReturnType<typeof verifiedUsage>;
    let iterator: AsyncIterator<StreamChunk> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new AbortController();
    const signal = AbortSignal.any([stop.signal, timeout.signal, ...(request.signal ? [request.signal] : [])]);
    const failureCode = () => state.stopped ? 'ACCOUNTING_STOPPED' : request.signal?.aborted ? 'MODEL_CANCELLED' : 'MODEL_TIMEOUT';
    const settleUnknown = () => {
      if (!id || settled) return;
      budget.settle(id);
      settled = true;
      state.lastFailure = new Date().toISOString();
      state.lastOutcome='failed';
    };
    try {
      if (state.stopped) throw new Error('ACCOUNTING_STOPPED');
      if (!state.live) throw new Error('MODEL_OFFLINE');
      if (signal.aborted) throw new Error(failureCode());
      const turn = request.sessionId ? turns.get(request.sessionId) : undefined;
      if (maximumPerTurn !== undefined && request.sessionId) {
        if (turn === undefined && !request.purpose) throw new Error('MODEL_TURN_CONTEXT_REQUIRED');
        if (turn !== undefined) {
          const prior = budget.db.prepare('SELECT COUNT(*) AS n FROM model_request_attribution WHERE session_id=? AND turn_seq=?')
            .get(request.sessionId, turn);
          if (Number(prior?.n) >= maximumPerTurn) throw new Error('MODEL_TURN_LIMIT');
        }
      }
      const inputTokens = Buffer.byteLength(JSON.stringify({ messages: request.messages, system: request.system,
        tools: request.tools, toolHistory: request.toolHistory }), 'utf8');
      id = budget.reserve(inputTokens, request.maxTokens ?? defaultOutputTokens);
      pending.set(id, settleUnknown);
      state.activeRequests = pending.size;
      budget.db.prepare('INSERT INTO model_request_attribution VALUES (?,?,?,?,?,?)')
        .run(id, request.sessionId ?? null, turn ?? null, request.purpose ?? 'conversation', request.provider, request.model);
      timer = setTimeout(() => timeout.abort(), timeoutMs);
      // next is invoked once. Frozen native options and their original signal are never rewritten.
      iterator = next()[Symbol.asyncIterator]();
      while (true) {
        const item = await nextWithSignal(() => iterator!.next(), signal, failureCode);
        if (item.done) { complete = true; break; }
        if (terminal !== undefined) failed = true;
        if (item.value.type === 'usage') usage = verifiedUsage(item.value.usage);
        if (item.value.type === 'finish') terminal = item.value.reason.kind;
        yield item.value;
      }
    } catch (error) {
      failed = true;
      state.lastFailure = new Date().toISOString();
      state.lastOutcome='failed';
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (id && !settled && complete && !failed && !signal.aborted && usage &&
          ['stop', 'tool-calls', 'max-tokens'].includes(terminal ?? '')) {
        budget.settle(id, usage);
        settled = true;
        state.lastSuccess = new Date().toISOString();
        state.lastOutcome='succeeded';
      } else settleUnknown();
      if (id) pending.delete(id);
      state.activeRequests = pending.size;
      if (!complete && iterator?.return) {
        // A provider ignoring its own signal must not block shutdown or trigger another paid call.
        try { void Promise.resolve(iterator.return()).catch(() => undefined); } catch {}
      }
    }
  }, { global: true, prepend: true });
  const dispose = (() => {
    if (state.stopped) return;
    state.stopped = true;
    stop.abort();
    for (const settle of pending.values()) settle();
    pending.clear();
    state.activeRequests = 0;
    offStream(); offEvents();
  }) as AccountingDisposer;
  dispose.state = state;
  dispose.setLive = value => {
    if (state.stopped) throw new Error('ACCOUNTING_STOPPED');
    if (typeof value !== 'boolean') throw new Error('INVALID_ACCOUNTING_POLICY');
    state.live = value;
  };
  return dispose;
}
