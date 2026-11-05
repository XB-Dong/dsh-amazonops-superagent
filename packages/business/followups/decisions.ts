import { digest, type Store, type Base } from '../core/store.ts';
import { safeText } from '../core/validation.ts';
import type { FollowupEvent } from '../../contracts/followups.ts';
import { liveEntity } from './risk.ts';

export type RuleDecision = 'accepted' | 'ignored' | 'would_accept';
const acceptedKey = (scope: string, ruleId: string, riskDigest: string) =>
  `followup-accepted-window:${digest([scope, ruleId, 'auto', riskDigest])}`;

export function acceptedWindow(store: Store, scope: string, ruleId: string, riskDigest: string): boolean {
  const row = store.db.prepare('SELECT result FROM receipts WHERE scope=? AND request_key=?')
    .get(scope, acceptedKey(scope, ruleId, riskDigest));
  if (!row) return false;
  const value = JSON.parse(String(row.result));
  return value.deleted !== true && value.decision === 'accepted';
}

export function eventRuleId(store: Store, scope: string, event: FollowupEvent): string {
  const owners = event.sources.filter(id => store.get<Base>(scope, id).kind === 'inventory-rule');
  if (owners.length !== 1) throw new Error('INVALID_RULE_EVENT');
  return owners[0];
}

/** Trusted native adapter port; intake delivery or model text cannot prove acceptance. */
export function recordRuleDecision(store: Store, scope: string, eventId: string,
  decision: RuleDecision, ticketId?: string): void {
  eventId = safeText(eventId, 100);
  if (!['accepted', 'ignored', 'would_accept'].includes(decision)) throw new Error('INVALID_RULE_DECISION');
  if (ticketId !== undefined) ticketId = safeText(ticketId, 100);
  store.transaction(() => {
    // Historical decisions remain recordable after the current rule changes. They are not new work.
    const event = liveEntity<FollowupEvent>(store, scope, eventId, 'followup-event');
    if (event.eventId !== eventId || event.eventClass !== 'risk_candidate' || event.watchId
      || !['auto', 'observe'].includes(event.ruleMode ?? '')) throw new Error('INVALID_RULE_EVENT');
    const ruleId = eventRuleId(store, scope, event);
    if (decision === 'accepted' && (event.ruleMode !== 'auto' || !ticketId)) throw new Error('RULE_ACCEPTANCE_PROOF_REQUIRED');
    const evidence = { eventId, decision, ...(ticketId ? { ticketId } : {}) };
    store.command(scope, `followup-rule-decision:${eventId}:${decision}`, evidence, () => {
      if (decision === 'accepted') store.once(scope, acceptedKey(scope, ruleId, event.risk.digest), () => ({
        ...evidence, ruleId, mode: 'auto', riskDigest: event.risk.digest, sources: event.sources,
      }));
      return evidence;
    });
  });
}
