/** Deterministic Anthropic-compatible SSE fixture; production agent/tool code is untouched. */
import { createServer, type ServerResponse } from 'node:http';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export type FixtureRequest = { tools?: { name: string }[]; messages?: { role: string; content: any }[]; model: string };
export const draftTitle = '本机离线验收：检查库存草稿';
export const draftChecklist = ['核对合成库存报表', '由cc确认后执行'];
export const resultText = '已保存库存检查任务草稿，等待cc确认；尚未执行外部操作。';
function blocks(body: FixtureRequest) {
  return (body.messages ?? []).flatMap(message => Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }]);
}
function toolResults(body: FixtureRequest, name: string) {
  const all = blocks(body);
  const ids = new Set(all.filter(block => block.type === 'tool_use' && block.name === name).map(block => block.id));
  return all.filter(block => block.type === 'tool_result' && ids.has(block.tool_use_id));
}
function emit(res: ServerResponse, name: string, data: unknown) { res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); }
function response(res: ServerResponse, index: number, tool?: { name: string; input: unknown }, answer = '本轮处理结束。') {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  emit(res, 'message_start', { type: 'message_start', message: { id: `fixture-message-${index}`, type: 'message', role: 'assistant',
    model: 'deepseek-flash', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } });
  if (tool) {
    emit(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `fixture-tool-${index}`, name: tool.name, input: {} } });
    emit(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } });
  } else {
    emit(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    emit(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer } });
  }
  emit(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  emit(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
  emit(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
export async function fakeModel(evidence: string) {
  const requests: { role: string; tool?: string; input?: unknown; path: string }[] = [];
  const control = { holdWorkers: false, activeWorkers: 0, abortedWorkers: 0 };
  const server = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as FixtureRequest;
      const all = blocks(body);
      const text = all.filter(block => block.type === 'text').map(block => block.text).join('\n');
      const worker = body.tools?.some(tool => tool.name === 'cc_prepare_task');
      let tool: { name: string; input: unknown } | undefined;
      let summary: string | undefined;
      const compacting = text.includes('You are now acting as a compaction engine');
      const continuing = text.includes('VERIFY_PERSISTED_COMPACTION');
      if (compacting) {
        if (!text.includes('WH-042') || !text.includes('6小时')) throw new Error('COMPACTION_INPUT_LOST_SOURCE_FACT');
        const result = toolResults(body, 'cc_prepare_task')[0];
        const resultText = typeof result?.content === 'string' ? result.content : result?.content?.find((block: any) => block.type === 'text')?.text;
        const task = JSON.parse(resultText ?? 'null');
        if (!task?.id || !task.sources?.[0]) throw new Error('COMPACTION_INPUT_LOST_COMMITTED_TOOL_RESULT');
        summary = `## Current Work\n- 已创建草稿 ${task.id}; source ${task.sources[0]}; cc_prepare_task 已提交且不能重复。\n## Critical Context\n- 准备提前量6小时；仓库WH-042；等待cc确认，未执行外部操作。`;
      } else if (continuing) {
        if (!text.includes('<compacted-summary>') || !text.includes('WH-042')) throw new Error('RESTART_DID_NOT_REPLAY_CHECKPOINT');
        if (text.includes('合成历史核验项')) throw new Error('RESTART_REINTRODUCED_SHADOWED_HISTORY');
      } else if (worker) {
        if (!toolResults(body, 'cc_prepare_task').length) tool = { name: 'cc_prepare_task', input: {
          title: draftTitle, timeZone: 'Asia/Shanghai', checklist: draftChecklist } };
        else if (!toolResults(body, 'orchestrator_report').length) tool = { name: 'orchestrator_report', input: { state: 'progress', summary: resultText } };
      } else {
        // The actual native candidate and report notices carry the authoritative IDs.
        const reports = [...text.matchAll(/"kind"\s*:\s*"worker_report"[^\n]*/g)];
        const report = reports.at(-1)?.[0];
        const ticketId = report && /"state"\s*:\s*"ready"/.test(report) && /"ticket_id"\s*:\s*"([^"\n]+)"/.exec(report)?.[1];
        const replied = all.some(block => block.type === 'tool_use' && block.name === 'orchestrator_reply' && block.input?.ticket_id === ticketId);
        if (ticketId && !replied) tool = { name: 'orchestrator_reply', input: { ticket_id: ticketId, purpose: 'result', text: resultText } };
        else {
          const candidate = text.split('\n').filter(line => /"next_action"\s*:\s*"Route it with orchestrator_route/.test(line)).at(-1);
          const triggerId = candidate && /"trigger_id"\s*:\s*"([^"\n]+)"/.exec(candidate)?.[1];
          const routed = all.some(block => block.type === 'tool_use' && block.name === 'orchestrator_route' &&
            block.input?.decisions?.some((decision: any) => decision.trigger_id === triggerId));
          if (triggerId && !routed) tool = { name: 'orchestrator_route', input: { decisions: [{ kind: 'accept', trigger_id: triggerId,
            title: draftTitle, worktree_name: 'offline-stock-draft', acknowledgement: '将保存库存检查草稿，等待cc确认。' }] } };
        }
      }
      const record = { role: compacting ? 'compaction' : continuing ? 'continued' : worker ? 'worker' : 'router', tool: tool?.name, input: tool?.input, path: req.url ?? '' };
      requests.push(record);
      appendFileSync(join(evidence, 'model-requests.jsonl'), JSON.stringify({ ...record, body }) + '\n');
      if (worker && control.holdWorkers) {
        control.activeWorkers++;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(': holding local synthetic generation for cancellation\n\n');
        res.once('close', () => { control.activeWorkers--; control.abortedWorkers++; });
        return;
      }
      response(res, requests.length, tool, summary);
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: String(error) })); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  return { server, requests, control, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
