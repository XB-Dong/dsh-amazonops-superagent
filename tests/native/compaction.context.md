## Context Map

Self-reviewed before implementation. Specification application v0.2.0; A02-01 requires actual native conversation compaction, persistence and restart. Baseline 3591ef8 includes 573fed4 and 6580b19.

| Files to add | Purpose |
| --- | --- |
| compaction.test.ts | Official DSH child lifecycle, loopback model, durable compaction and restart assertions |
| compaction-probe.ts | Test-only IPC resolves the actual Agent and its retained preset backend with agentPresets.serviceFor, then calls CompactionEngine.compactNow |
| compaction-model.ts | Synthetic Anthropic SSE, validates real summarizer input and returns a deterministic checkpoint |

Dependencies are read-only: host accounting/Source/AgentTools, native Runtime, official Agent/SessionController/CompactionEngine, session persistence, buildProject/localPatch and existing E2E network fence. No production API, schema or dependency changes.

The installed official compaction types document compactNow(agent, signal) as an idle maintenance transaction with durable start/end markers and persistence checkpoint. SessionController itself has no compact method. The isolated preset service is obtained through the official AgentPresetRegistry.serviceFor API. Tests use this actual public service, not an alternative agent loop or manually appended compacted events. Existing native-e2e model and process lifecycle patterns are reference fixtures. The test disables automatic pressure compaction only in its synthetic profile, sets zero retention for a useful whole-history replacement, and leaves a progress-reporting idle worker open so normal ended-ticket authorization still applies. Tests exercise established upstream behavior and are regression acceptance; no invented preimplementation product Red is claimed.
