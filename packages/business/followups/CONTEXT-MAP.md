# P1 Followups Context Map

Task: P1-WATCH-DOMAIN, baseline 0e06220d239675b2029166a2fde110384d0bba1a, frozen followups contract 0.3.0.

## Files to Modify

| File | Purpose | Changes Needed |
| --- | --- | --- |
| packages/business/followups/** | Scoped finite watches and deterministic risk-rule outbox | Add validation/risk selection, commands, persistent cursor/outbox |
| packages/business/index.ts | Domain export | Export Followups service |
| tests/business/followups*.test.ts | Behavioral tests | Actual Red/Green for authorization, lifetime, replay, crash, privacy and no self-trigger |

## Dependencies

Store transactions, receipts, entities, tombstones and business_events; existing forecast/inventory calculation; frozen shared followups DTO. No Runtime, HTTP, React or model dependencies. Source identity is supplied by trusted host and checked against a same-scope user source. Native binding and delivery acknowledgement remain outside this module.

## Test Files

Existing inventory and privacy-closure regressions supply fixture patterns. New tests use synthetic temp SQLite only, no production data or network. Actual failure evidence is kept outside Git.

## Reference Patterns

Store.command for payload conflict/idempotence, Store.transaction for cursor and outbox atomicity, existing projectInventory for deterministic calculation, sources for privacy closure.

## Risk Assessment

- [x] New exported domain API; shared DTO unchanged.
- [x] New entities only; no schema migration or independent state store.
- [x] Persistent cursor/outbox must commit together; replay must not duplicate effects.
- [x] Current source closure and time checks precede pending delivery, including after restart.

Self-review completed before implementation. Domain authorization never grants native execution or external business permissions.

Follow-up review findings retain the same root task and scope: latest-transition filtering must prevent an older pending risk from becoming actionable when facts return to it; order-insensitive inventory arrays require canonical hashing. The trusted native adapter also needs a CAS `complete` command with persisted expiry and current authorization validation. These edits remain inside the existing followups module and behavior tests; no shared DTO changes.
