# Inventory followups

`Followups(store, clock?)` implements the frozen P1 domain contract. It owns scoped finite watch authorizations, one explicitly configured inventory-risk rule, and a durable business-event cursor/outbox. It does not own native Tickets, assignments, model calls or notifications.

## Commands and reads

- `create(scope, input, sourceId)` requires a same-scope user source supplied by the trusted host, an existing inventory plan and a future ISO expiry. Stable request IDs reject changed payloads. `get` and `list` return public watch DTOs.
- `bindTicket` binds once to the real native Ticket; a different binding is rejected. `stop` checks the current revision. `expire` persists due expirations without a model call. `requireActive` checks status and time before execution.
- `risk` rereads effective matching inventory/forecast versions and uses the existing deterministic projection. It does not infer a forecast from unconfirmed CSV data. The digest excludes entity IDs, timestamps and other version metadata.
- `configureRule` accepts only an explicit object list and off/observe/auto. It records request receipts. The host must enforce the auto-activation gate. Repeating identical normalized mode/list semantics preserves the policy revision. Delivered auto risk windows are not recreated by off/on toggles.
- `scan` consumes only inventory, forecast and report-import references whose event kind matches the stored entity kind. Cursor and pending events commit in one Store transaction. A storage failure aborts both. Multiple pages can coalesce into the latest current risk; internal followup writes do not emit new business events.
- `pending` rereads current authorization, expiry, sources, policy and risk. Old policy revisions, unrelated scopes/objects, stale risk, revoked/deleted sources and stopped watches cannot be delivered. `markDelivered` is idempotent; call it only after the native consumer has durably accepted the input.
- `snapshot`, `get`, `list`, `rule`, `risk` and `pending` are reads. They do not expire watches or consume queued work. The host explicitly schedules `scan`/`expire`.

An active watch takes responsibility for its business identity, suppressing overlapping proactive candidates. A semantic risk transition back to the original state is a new watch event. Duplicate source inputs and re-created adapters do not repeat an unchanged transition. Removing or changing a rule invalidates its earlier pending candidates; the module never grants authority based on event text.

## Validation scope

Thirteen new synthetic behavior tests cover scoped creation/conflicts, native binding, semantic changes, actual database close/reopen, multiple event pages, durable-enqueue failure, stopping/expiry/deletion/revocation, observe/auto/off behavior, current-fact coalescing, strict calendar expiry and event-kind agreement. The complete business suite has 99 passing tests on this candidate. Typecheck and build also passed. Native orchestration, actual delivery, browser behavior, model usage and production acceptance belong to the integration tasks and are not claimed here.
