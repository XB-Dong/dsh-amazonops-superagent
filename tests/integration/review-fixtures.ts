// Unit ports exercise the real host/business boundary; they do not simulate a live model.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(process.env.AMAZONOPS_REVIEW_ROOT ?? process.cwd());
export const { Business } = await import(pathToFileURL(join(root, 'packages/business/index.ts')).href);
export const { WorkbenchSource } = await import(pathToFileURL(join(root, 'packages/host/source.ts')).href);
export const { AgentTools } = await import(pathToFileURL(join(root, 'packages/host/agent-tools.ts')).href);

export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'amazonops-host-unit-'));
  const business = new Business(dir);
  const triggers = new Map<string, any>();
  const tickets = new Map<string, any>();
  const received: any[] = [];
  const stopped: string[] = [];
  const kinds: any[] = [];
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE outbox (value TEXT NOT NULL)');
  const runtime: any = {
    sources: { register: (kind: any) => { kinds.push(kind); return () => {}; } },
    store: { db,
      triggers: { get: (id: string) => triggers.get(id) },
      tickets: { get: (id: string) => tickets.get(id), list: () => [...tickets.values()],
        open: () => [...tickets.values()].filter(ticket => !ticket.ended) },
      read: {
        threadTriggers: (key: string, limit: number) => [...triggers.values()]
          .filter(trigger => trigger.threads.some((thread: any) => `${thread.source}:${thread.id}` === key)).slice(-limit),
        triggers: () => ({ items: [...triggers.values()] }),
      },
    },
    context: () => ({ receive: async (trigger: any) => { received.push(trigger); triggers.set(trigger.id, trigger); } }),
    engine: { stopTicket: (id: string) => { stopped.push(id); tickets.get(id).ended = { outcome: 'cancelled' }; } },
  };
  const source = new WorkbenchSource(runtime, business);
  source.register();
  async function ticket(text = '准备活动检查清单', requestId = 'first') {
    const result = await source.submit('main', text, requestId);
    const row: any = { id: `ticket-${requestId}`, title: text, origin: { triggerId: result.messageId, triggerIds: [result.messageId] },
      inputs: [], assignments: [], updatedAt: '2026-01-01T00:00:00.000Z' };
    tickets.set(row.id, row);
    return { row, result };
  }
  function agent(row: any) {
    const contexts = new Map<string, any>();
    const listeners: any[] = [];
    const providers: any[] = [];
    const controller = new AbortController();
    const value: any = { id: `worker-${row.id}`, ctx: {
      systemPrompt: { section: () => {}, context: (spec: any) => contexts.set(spec.name, spec) },
      on: (name: string, callback: any) => { listeners.push({ name, callback }); return () => {}; },
      skills: { registerProvider: (factory: any) => providers.push(factory({ signal: controller.signal, invalidate: () => {} })) },
    } };
    value.ctx.effect = (callback: any) => callback();
    value.ctx.inject = (_dependencies: string[], callback: any) => callback(value.ctx);
    const tools = new AgentTools(business, () => runtime);
    tools.onAgent(value, row);
    const execute = (name: string, args: any) => tools.tools(value, row).find((tool: any) => tool.name === name)!.execute(args, controller.signal);
    return { value, contexts, listeners, providers, controller, tools, execute };
  }
  function skill() {
    const origin = business.store.source('main', '经cc确认完成的活动流程');
    const task = business.store.create('main', 'task', { title: '准备活动', status: 'done', checklist: ['核对时间', '核对价格'],
      checked: [true, true], timeZone: 'Asia/Shanghai', sources: [origin.id], confirmedSuccess: true });
    return business.learning.deriveSkill('main', task.id);
  }
  return { business, runtime, source, db, triggers, tickets, received, stopped, kinds, ticket, agent, skill,
    dispose: () => { db.close(); business.store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
