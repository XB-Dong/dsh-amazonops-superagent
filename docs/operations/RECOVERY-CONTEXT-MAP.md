# P0 Recovery CLI Context Map

Baseline d5084d4; root task P0-INTEGRATION, spec0.2.0. Self-reviewed before edits. Allowed changes: scripts/recovery.ts, tests/integration/recovery-cli.test.ts and local recovery documentation. No changes to business persistence/recovery, host or other agents' paths.

The existing restoreRecoveryPoint API verifies hashes, copies files, merges current usage and immutable attribution, and opens Store to replay latest privacy intent. The CLI must preserve this API behavior rather than invent its own merge. It adds nonoverlapping path validation, symlink/manifest confinement, stopped-input documentation and a staged empty-target publish. Input databases/ledger remain read-only and diagnostics contain no paths or payloads.

Tests use newly created temporary synthetic old-format SQLite, sources/tasks, immutable file hashes and a current budget/attribution/ledger. Verify preserved IDs/refs and output, no budget refund or deleted-data resurrection, failure without partial published target, rejected path aliases/nonempty target, and no sensitive diagnostic output. No old service, cloud or real data is accessed.
