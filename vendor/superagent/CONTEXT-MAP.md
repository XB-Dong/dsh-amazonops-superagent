# Native adaptation context map

Baseline: frozen P0 dispatch 59513e9d9b0ab805c0b67b5174d72bac2e52b105; upstream 6337fc823ce20251c8de8085948165c81aaa701e. Native owner only.

## Files to Modify

| File | Purpose | Changes Needed |
| --- | --- | --- |
| vendor/superagent/src/{deployment,index,app/runtime,app/setup,app/sessions,executor/dsh}.ts | Actual native runtime composition | Operations mode, Windows-safe paths, restrictive sessions, zero model retries, extension seam |
| vendor/superagent/src/app/{prompts,tools/executor}.ts | Coding assumptions | Neutral results and business-only prompt/skill composition |
| vendor/superagent/src/sources/* | Source extension | Expose stable SourceHost/SourceKind interface without replacing core |
| profiles/* | Native configuration | Minimal native profile and operations preset |
| tests/native/* | Actual startup and policy probes | Offline native startup and behavior Red/Green |

## Dependencies

Root owns pinned DSH rc.3 dependencies, shared contracts and host integration. No root manifest or lock edits by this agent. Vendor preserves original Runtime, Engine, Store, Effects and all core work state.

## Test Files

Native tests cover Windows state paths, no required GitHub CLI, allowed tool registry, retry policy and actual DSH-host Runtime startup. Synthetic/offline model only. Installation errors are not behavioral Red.

## Reference Patterns

Upstream src/index.ts instantiates Runtime; Runtime constructs Engine/Store/SourceRegistry/Assessor/DshExecutor/Outbox. DSH profiles load Cordis plugins, and native client slots register main panels.

## Risk Assessment

- [x] Alpha/rc API compatibility needs actual startup verification.
- [x] Role permissions and tools must remain constrained after resume.
- [x] No cloud, old repository writes, credentials or live model calls.
- [x] Upstream adaptation is bounded and recorded; core is retained.

Self-reviewed before implementation: all writes limited to assigned vendor, profile and native-test paths, plus the explicitly authorized node_modules read junction.
