# Physical native workspace authority

Baseline: `7608cc7`; application v0.2. Owner: native path compatibility and isolation.

- `vendor/superagent/src/app/operations-workspace.ts`: fixed native physical root and identity; reject lexical ancestor links before following paths or creating directories.
- `vendor/superagent/src/app/runtime.ts`: establish physical authority before native directory lock and database creation; use the canonical root throughout this instance.
- `vendor/superagent/src/executor/dsh.ts`: check root authority and worker parents before operations mkdir.
- `vendor/superagent/src/app/sessions.ts`: prepare physical target before official cwd change; verify physical expected/current paths at every managed model/tool step.
- `tests/native/windows-workspace.test.ts`: real Windows DOS short-name query, isolated child test runners with actual official DSH master and worker/recovery; real junction and root-replacement denial tests.
- `tests/integration/native-e2e-queued.test.ts`: physical directory membership assertions accept equivalent aliases; different old-home paths, full source-tree preservation and actual fallback refusal remain mandatory.

Self-review: no shared contracts, core Engine, model credentials, production runtime or cloud changes. No short-name text replacements and no removal of execution guards. A realpath failure denies execution. Root identity is pinned, and both lexical ancestor chains are checked before canonical comparison, so replacing expected/current with the same outward junction cannot authorize it.

Validation: original native master fails under a real `%~sI` TEMP alias with `OPERATIONS_WORKSPACE_CHANGED`; the fixed real native master and queued/restored worker tests pass. Nested test drivers scrub `NODE_TEST_CONTEXT` and require a nonzero executed-test count, preventing recursive-runner empty passes. The five filesystem safety cases use real links/replacements rather than mocked case strings. Raw alias and native outputs remain in a unique private evidence directory outside Git.
