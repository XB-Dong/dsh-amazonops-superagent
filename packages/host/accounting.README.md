# Native LLM accounting

## Context Map

P0-ACCOUNTING, application specification v0.2.0, baseline a809d50c0c32f0a8173bdac558185e5b36737305. Self-reviewed before implementation. Allowed files are accounting.ts, this document and the matching integration-directory unit test.

| Dependency | Responsibility |
| --- | --- |
| Installed dsh-llm rc.3 GenerateOptions/StreamChunk/TokenUsage | Actual immutable native stream request and disjoint cache counters |
| Cordis Context waterfall | Register one global llm/stream interceptor; call next exactly once |
| Native session/event turn boundaries | Session-local turn guard, never a lifetime request counter |
| Business ModelBudget | Durable reserve/settle and conservative unknown usage |

Tests use a real Cordis Context with controlled waterfall streams and synthetic native-event envelopes. They are unit tests, not a proof that the full deployed native application is wired correctly. The Leader owns native-host integration acceptance.

## Interface

`installAccounting(ctx, budget, options?)` returns a callable disposer with `.state` and `.setLive(boolean)`. Options are `live` (default false), `maxRequestsPerTurn` (optional), `timeoutMs` (default 90000) and `defaultOutputTokens` (default 1024 for a call without explicit maxTokens). Install it on the native host before any Agent turn starts. The operator must stop admitting model work before disposing the middleware and closing the budget database.

`state` exposes `live`, `stopped`, `activeRequests`, `lastSuccess` and `lastFailure`. A success means a verified complete provider call, not business-task completion. Switching live off denies future model calls before reservation/dispatch; deterministic business services are independent. Disposing marks active reservations unknown immediately and stops waiting on an adapter that ignores cancellation.

The interceptor calls `next()` once, reserves durably before consumption, and settles verified usage only when a full successful terminal stream contains valid usage. Billed input is uncached input plus disjoint cache-read and cache-write input; reasoning is already within output and is not double-counted. Missing/inconsistent usage, a missing or failed finish, interruption, consumer return, timeout and shutdown retain the reservation with `usage_verified=0`.

Each reservation also has a reference-only row in `model_request_attribution(request_id, session_id, turn_seq, purpose, provider, model)`. It contains no prompt/body/credential. SQLite backup includes the table; restoring an older budget must merge current attribution rows as well as current model_requests so later audit facts are not discarded.

The optional per-turn limit uses actual global `session/event` turn/start and turn/end identities, with request counts persisted per session/turn sequence. Auxiliary calls in an open turn count toward the same guard; title/compaction calls without an open turn are still billed but do not invent a conversation turn. A normal session call whose turn was not observed fails closed instead of silently using a lifetime or guessed counter. A new turn receives its own guard.

Native GenerateOptions may be deep-frozen. The middleware never changes its content, maxTokens or signal. Its timeout races consumer reads and closes the iterator best-effort; it cannot replace the signal captured by `next()`. The original native signal and adapter transport timeout must enforce actual network cancellation. There is no provider retry, worker restart or repeated next call here.

## Validation

The first five behavior cases produced actual Red (exit 1) before implementation. Final controlled-waterfall unit tests cover cache accounting, uncertain usage, zero automatic redispatch, offline denial, all-role purposes, true turn reset, cancellation, shutdown, malformed usage, timeout and native error finish. They do not claim full native application or live-model validation. No credentials, live model calls, production or old-project writes were used.
