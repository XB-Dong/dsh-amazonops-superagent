# Native offline E2E context map

Baseline: `70df63d`; application contract v0.2. Owner: native integration fixture.

- `scripts/build.mjs`: builds actual vendor, host and client in this isolated worktree.
- `profiles/local.ts`, `profiles/operations.ts`: official DSH profile, neutral operations presets and private paths.
- `packages/host/source.ts`: authenticated input, native Source, Engine admission, outbox delivery and cancellation.
- `packages/host/agent-tools.ts`: per-ticket `cc_prepare_task` callback and provenance.
- `vendor/superagent/src/app/tools/{main,executor}.ts`: route/report/reply schemas; real upstream Engine remains unchanged.
- `tests/integration/native-e2e*`: fake Anthropic SSE, process-only network guard, read-only session/runtime evidence probe, assertions.

Self-review: no host or vendor implementation changes; no old runtime directories; no real credentials or external model endpoint. The fixture emits model responses only and never calls Engine/tool callbacks itself. Evidence stays outside Git in an isolated temporary home. Build artifacts stay in the isolated worktree. A blocked external network attempt fails acceptance.

Run with Node 24: `node --experimental-transform-types --test tests/integration/native-e2e.test.ts`. `node scripts/check.mjs` checks fixture types together with application types. The test prints the external evidence directory; files contain only synthetic requests, native session events, read-only state, tool callback results, build provenance and request accounting. They are deliberately not committed.

Observed acceptance: actual Source admission, Engine decision, worker session, one successful callback for each route/prepare/report/reply tool, one draft preserving user-source lineage, one channel result, duplicate/conflict handling, clean official-launcher disposal and restart, unchanged model count on replay, a distinct new ticket, active-stream cancellation, and durable accounting for all nine local streams. A separate negative test proves the network fence rejects fetch, HTTPS and raw TCP to non-loopback addresses before connecting. The fence applies only to the isolated native child process.

Actual integration Red/Green: the initial authenticated request was ignored because the Source schema default did not initialize stored policy; host `174aab0` fixed initialization. The next run created a ticket but failed worker startup because the business skill provider read an undeclared Cordis injection; host `e083e09` fixed the provider scope. Origin acceptance links through decisionId rather than follow-up fanout; that assertion correction was a fixture error. Catchable Windows shutdown uses private test IPC to emit the official launcher's SIGTERM event; direct process.kill is hard termination and was not evidence of a product recovery failure. This fixture does not assess real-model answer quality or browser rendering.
