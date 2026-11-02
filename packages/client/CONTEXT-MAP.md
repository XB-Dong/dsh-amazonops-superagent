# P0 Client Context Map

Baseline59513e9, specapplication-v0.2. Allowed paths packages/client and tests/client only. Self-reviewed before edits. Old ccagent is read-only.

| Files to modify | Purpose |
| --- | --- |
| Client page components and styles | Preserve all delivered Chinese forms and navigation inside a native DSH panel |
| api.ts, controller.ts | Authenticated native-host API and separated page state; no old SSE transport |
| Assistant.tsx, work.ts | Source submission, work projection, explicit cancel and native Session navigation |
| index.tsx | Native DSH registration after native seam verification |
| tests/client | Reused pure regression assertions and new API/work behavior tests |

Dependencies: Leader-owned contracts/model.ts, native client plugin seam, host /amazonops/api. Client imports no business or database implementation. Legacy components/CSS adapted under original MIT license (XB-Dong).

Risks: React host singleton, CSS scope, missing DTO fields, ticket-ready versus business-done, polling duplication, disconnect cancellation. Do not infer browser acceptance from static builds. Actual native integration/browser remains Leader acceptance.
