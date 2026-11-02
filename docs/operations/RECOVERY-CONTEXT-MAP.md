# P0 Recovery CLI Context Map

## Path isolation repair (baseline 18714bb)

Self-reviewed before implementation. Root task P0-INTEGRATION, spec 0.2.0.

| File | Responsibility / planned change |
| --- | --- |
| scripts/start.mjs | Reject existing links in the original home ancestors and complete writable home tree before settings creation, launch writes or spawn. |
| scripts/recovery.ts | Reject links in original backup/current/destination ancestors before canonicalization; preserve recovery merge behavior. |
| tests/packaging/launcher.test.ts | Synthetic junction fixtures; prove rejection before spawn or input changes. |
| tests/integration/recovery-cli.test.ts | Synthetic linked input/root/ancestor/destination fixtures; prove no restore publication or input changes. |
| tests/integration/native-e2e-scripts.d.ts | Declare existing launcher helpers with concrete child-process types for product typechecking. |

Dependencies: profiles/local.ts specifies data/harness and data/superagent destinations. Business restoreRecoveryPoint owns privacy and accounting merges and remains unchanged. Existing tests/native/packaging.test.ts covers launch configuration and environment; the new packaging test adds only path isolation. No schema, profile, credential or runtime changes. Raw Red/Green output stays in private support evidence. All fixtures are new temporary directories; no build, pnpm or live service interaction.

Validation: the new test command against baseline launcher/recovery produced exit 1 (18 failed assertions/subtests), including actual invocation of the injected spawn seam. The repaired sources produced exit 0 with 24 tests passed, including clean-home launch and unchanged fixture snapshots on rejection. Product TypeScript check and preparation artifact verification passed. An additional existing packaging regression ran once and built only this isolated worktree's vendor output and a temporary application fixture; the active application's directory was not built. Node path-based checks reject existing links but do not claim atomic protection against a separate process concurrently replacing directories; inputs must remain stopped/private as required by the recovery operation.

Baseline d5084d4; root task P0-INTEGRATION, spec0.2.0. Self-reviewed before edits. Allowed changes: scripts/recovery.ts, tests/integration/recovery-cli.test.ts and local recovery documentation. No changes to business persistence/recovery, host or other agents' paths.

The existing restoreRecoveryPoint API verifies hashes, copies files, merges current usage and immutable attribution, and opens Store to replay latest privacy intent. The CLI must preserve this API behavior rather than invent its own merge. It adds nonoverlapping path validation, symlink/manifest confinement, stopped-input documentation and a staged empty-target publish. Input databases/ledger remain read-only and diagnostics contain no paths or payloads.

Tests use newly created temporary synthetic old-format SQLite, sources/tasks, immutable file hashes and a current budget/attribution/ledger. Verify preserved IDs/refs and output, no budget refund or deleted-data resurrection, failure without partial published target, rejected path aliases/nonempty target, and no sensitive diagnostic output. No old service, cloud or real data is accessed.
