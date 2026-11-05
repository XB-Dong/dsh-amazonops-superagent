import { z } from 'zod';
import type { WorkAction, WorkTicket } from '../contracts/model.ts';
import { digest, type Base } from '../business/index.ts';
import { safeText } from '../business/core/validation.ts';
import { canRetry, ticketStage, type Ticket } from '../../vendor/superagent/src/extension.ts';
import type { WorkbenchSource } from './source.ts';

const schema = z.object({ ticketId: z.string().min(1), requestId: z.string().regex(/^[\w-]{1,80}$/),
  expectedUpdatedAt: z.string().min(1), action: z.enum(['supplement', 'answer', 'retry', 'stop']),
  text: z.string().optional(), attentionId: z.string().optional() }).strict();
type Receipt = Base & { fingerprint: string; assignmentId?: string; completed: boolean; result?: unknown };

export function projectResponsibility(ticket: Ticket, threadId: string): Partial<WorkTicket> {
  const assignment = ticket.assignments.at(-1);
  const actions: NonNullable<WorkTicket['actions']> = ticket.ended ? [] : ['supplement'];
  if (!ticket.ended && ticket.attention) actions.push('answer');
  if (canRetry(ticket)) actions.push('retry');
  if (!ticket.ended) actions.push('stop');
  return { stage: ticketStage(ticket), updatedAt: ticket.updatedAt, createdAt: ticket.createdAt,
    ...(ticket.mandate ? { mandate: { scope: ticket.mandate.scope, strength: ticket.mandate.strength,
      policyVersion: ticket.mandate.policyVersion } } : {}),
    ...(assignment ? { assignment: { id: assignment.id, state: assignment.state,
      startedAt: assignment.startedAt, endedReason: assignment.endedReason } } : {}),
    ...(ticket.attention ? { attention: { id: ticket.attention.id, question: ticket.attention.question } } : {}),
    source: { threadId, messageId: ticket.origin.triggerId }, actions };
}

export async function actOnWork(source: WorkbenchSource, scope: string, input: WorkAction): Promise<unknown> {
  const body = schema.parse(input);
  if (body.action === 'answer' || body.action === 'supplement') body.text = safeText(body.text, 2000);
  const store = source.business.store;
  const fingerprint = digest(body);
  const receiptId = `work-action:${body.requestId}`;
  // The intent and version fence precede native side effects. A different request cannot own
  // the same ticket version while an interrupted action is being recovered.
  let receipt = store.list<Receipt>(scope, 'work-action').find(row => row.id === receiptId);
  if (receipt && receipt.fingerprint !== fingerprint) throw new Error('REQUEST_CONFLICT');
  if (receipt?.completed) return receipt.result;
  if (!source.allowedTicket(scope, body.ticketId)) throw new Error('NOT_FOUND');
  let ticket = source.runtime.store.tickets.get(body.ticketId)!;
  if (!receipt) {
    if (ticket.updatedAt !== body.expectedUpdatedAt) throw new Error('STALE_TICKET');
    if (ticket.ended) throw new Error('TICKET_ENDED');
    if (body.action === 'answer' && ticket.attention?.id !== body.attentionId) throw new Error('STALE_ATTENTION');
    if (body.action === 'retry' && !canRetry(ticket)) throw new Error('NOT_RETRYABLE');
    receipt = store.transaction(() => {
      const owner = store.once(scope, `work-version:${ticket.id}:${ticket.updatedAt}`, () => ({ requestId: body.requestId }));
      if (owner.requestId !== body.requestId) throw new Error('STALE_TICKET');
      return store.create(scope, 'work-action', { fingerprint, assignmentId: ticket.assignments.at(-1)?.id,
        completed: false, sourceId: ticket.origin.triggerId }, receiptId);
    });
  }
  let result: unknown;
  if (body.action === 'supplement' || body.action === 'answer') {
    const nativeSourceId = `human-work-action-${body.requestId}`;
    const existing = source.runtime.store.triggers.get(nativeSourceId);
    if (!existing) {
      if (ticket.updatedAt !== body.expectedUpdatedAt) throw new Error('STALE_TICKET');
      if (body.action === 'answer' && ticket.attention?.id !== body.attentionId) throw new Error('STALE_ATTENTION');
      const origin = source.runtime.store.triggers.get(ticket.origin.triggerId)!;
      result = await source.submit(scope, body.text!, `work-action-${body.requestId}`, origin.threads[0]!.id);
    } else result = { messageId: existing.id, threadId: existing.threads[0]!.id };
  } else if (body.action === 'retry') {
    const old = ticket.assignments.find(row => row.id === receipt!.assignmentId);
    if (ticket.assignments.at(-1)?.id === receipt.assignmentId) {
      if (ticket.updatedAt !== body.expectedUpdatedAt || !canRetry(ticket)) throw new Error('STALE_TICKET');
      ticket = source.runtime.engine.retryTicket(ticket.id);
    } else if (old?.endedReason !== 'retried') throw new Error('STALE_TICKET');
    result = { ticketId: ticket.id, status: 'retry_requested', assignmentId: ticket.assignments.at(-1)?.id };
  } else {
    const reason = `cc workbench stop ${body.requestId}`;
    if (!ticket.ended) {
      if (ticket.updatedAt !== body.expectedUpdatedAt) throw new Error('STALE_TICKET');
      source.runtime.engine.stopTicket(ticket.id, reason);
    } else if (ticket.ended.by !== 'human' || ticket.ended.reason !== reason) throw new Error('STALE_TICKET');
    result = { ticketId: ticket.id, status: 'stopped' };
  }
  store.update(receipt, { completed: true, result });
  return result;
}
