# Backend Context Map

2026-11-02. Baseline 59513e9d9b0ab805c0b67b5174d72bac2e52b105; application contract v0.2.0. Self-reviewed before migration.

## Files to Modify

| File | Purpose | Changes |
| --- | --- | --- |
| packages/business/core | Scoped storage, model ledger, privacy and recovery | Preserve rules; add nested transaction support and payload-bound command receipts |
| packages/business/operations | Tasks, activities, notes and deterministic analysis | Task owns its types; no dependency on Learning; persist success events |
| packages/business/learning | Feedback, memory and approved workflows | Consume committed success events explicitly; preserve confirmed provenance |
| packages/business/commands-* | Typed capability command handlers | Replace the universal action chain; reuse services for UI and tools |
| packages/business/index.ts | Public application facade | Business(dataDir), readonly snapshot, command, explicit tick, trusted tool operation identity |
| tests/business | Domain regressions and new boundary tests | Migrate unchanged assertions and retain real Red/Green for new behavior |

## Dependencies

| Dependency | Relationship |
| --- | --- |
| ccagent packages/core, operations and learning at bc96429 | Read-only source and regression reference, preserve MIT attribution |
| Shared application/domain/tool contracts | Input/output fields and semantic boundaries owned by Leader |
| Node built-in sqlite/fs/crypto | Single business persistence owner; no model, cloud or network dependency |

## Test Files

Domain rule, budget, recovery, privacy and context regression tests are copied with import adaptation. New behavior tests verify query purity, payload conflicts and event-driven workflow learning before implementation changes.

## Reference Patterns

Preserve TaskCopies transaction/CAS, advertising micro-unit arithmetic, report content fingerprints, shared inventory unique allocation and durable privacy intent. Do not copy old Chat/HTTP host.

## Risk Assessment

- [x] Nested application/command transactions must preserve existing atomicity.
- [x] Event decoupling changes when learning runs; explicit tick must retain paused pending work.
- [x] Deleted command receipts must fail closed rather than restore cached data.
- [ ] Cloud/database migration: prohibited; synthetic fixtures only.
