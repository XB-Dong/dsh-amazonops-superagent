# Maintenance inspection context map

P1-HANDOVER implementation; root task P1-CLOUD-SUCCESSOR, baseline bb3b1bbaa32aab5a423039f10b0a71f9cdfbecf9, frozen P1 specification 0.3.0. Only synthetic data and offline execution in this task.

## Files to Modify

| File | Purpose | Changes Needed |
| --- | --- | --- |
| packages/business/maintenance/** | Isolated maintenance inspection | Private consistent copies, full-set fingerprints, scoped legacy decisions, fresh authority lease and read-only reports |
| scripts/maintenance.ts | Operator CLI | Explicit init/check, private outputs, aggregate stdout, no scheduler/model/development actions |
| tests/integration/maintenance.test.ts | Behavior | No-change, revisions, same-version changes, deletion, capture queues, authority and WAL/input preservation |

## Dependencies

Node SQLite and filesystem APIs only. Read the existing entities/tombstones schemas without opening production SQLite or changing business services. Source databases, WAL/SHM, registry and state remain byte-identical. Reports and initialized state stay outside Git and outside input trees. Legacy decisions remain data and never grant development authority.

## Reference Patterns

Migration modules use private copied DB/WAL and full-table fingerprints. P1 G3 requires an actual handover_validation read, distinct from automation readback; G4 normal maintenance starts only after business completion. The checker never opens waves, runs models or deploys.

## Risk Assessment

- No product API or database schema changes.
- Private output must not leak to a repository or overlap input state.
- Stale authority and missing/corrupt baseline must fail closed.
- Source capture changing during inspection must fail rather than silently omit a WAL update.

## Self-review

Reviewed before implementation. The parent approved a per-run expiresAt lease in addition to persistent production authority; a fresh lease is issued by the authorized Leader after checking current production and exclusive ownership, without new user approval.
