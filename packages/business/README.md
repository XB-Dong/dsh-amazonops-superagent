# Business services

TypeScript business services for the native SuperAgent host. This package contains no HTTP server, model client, agent loop or UI dependency.

Source provenance: deterministic domain/storage/learning rules and unchanged regression assertions were migrated from [XB-Dong/ccagent](https://github.com/XB-Dong/ccagent/tree/bc964298d49ad399ae325f57068c9149502b8c62), Copyright (c) 2026 XB-Dong, MIT. The original license is retained in [LICENSE](LICENSE). New refactoring preserves those business semantics.

## Public API

- `new Business(dataDir)` owns `business.sqlite`; the legacy `(store, dataDir)` overload exists for migrated behavior fixtures.
- `snapshot(scope)` returns typed readonly-query projections, never drains jobs, emits events, invokes a model or creates a native ticket. `sessions` is empty; the host projects the native session authority.
- `command(scope, action, input)` dispatches through capability maps. A supplied `requestId` binds a canonical payload, returns the stored result on replay, and rejects changed payload. Entity, receipt and reference-only business event commit together.
- `tool(scope, sourceId, action, input, operationId?)` preserves all nine tools. Three writing tools require a trusted source plus persistent `operationId`; changing an Assignment or process must not allocate a new operation identity.
- `tick(scope)` explicitly consumes capture and successful-workflow jobs and advances internal activity reminders. Learning pause retains pending events. Tasks own their types/invariants and have no Learning dependency.
- `onChange(listener)` invalidates host projections after committed command/tool/worker writes. Listeners cannot roll back business commits. Consumers must still validate Skill status/provenance/hash at read and execution.
- `store.events(scope, afterSequence, limit)` reads the durable business outbox. Events contain derived kinds and entity references only. The host must not feed these events into new SuperAgent Eval or interpret them as human authority.

The index also exports domain types, `Store`, `ModelBudget`, budget policy/limits and recovery functions. Consumers that only need DTOs should use the independent shared contracts package instead.

## Recovery integration

`createRecoveryPoint(store, budget, dataDir, backupRoot)` backs up business and usage SQLite through the backup API and inventories `harness`, `superagent`, `files`, `exports` and the privacy ledger. The native host must first pause/flush Runtime/Store/Session owners. Put their isolated state beneath the corresponding directories; this helper does not claim to stop a native runtime by itself.

`restoreRecoveryPoint(directory, emptyTarget, currentPrivacyLedger, currentBudget)` verifies manifest paths/hashes, restores into an empty isolated target, applies current privacy decisions and merges current accounting without refunding history. Supply the current ledger even if empty. Native lineage/session denylist and orchestration flush/restart are host responsibilities.

## Verification

`node --test tests/business/*.test.ts` runs migrated regressions plus new behavior/fault tests. `node node_modules/typescript/bin/tsc -p packages/business/tsconfig.json` checks this package and its tests strictly.

New behavior Red/Green covers query purity, payload conflicts, delayed workflow consumption, multi-segment requirement IDs, native-state/file recovery coverage and durable reference-only outbox. Unchanged migrated rules are regression coverage, not invented TDD Red. Native host, browser, live-model and production behavior are not proven by these domain tests.
