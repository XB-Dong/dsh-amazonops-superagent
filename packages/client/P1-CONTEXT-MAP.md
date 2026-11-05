# P1 Client Context Map

Baseline69024c2; frozen p1-workbench-v0.3 and contracts/model.ts plus followups.ts. Self-reviewed before edits. Owner only packages/client and tests/client; no runtime, domain, shared DTO or cloud writes.

| Files to modify | Purpose |
| --- | --- |
| App.tsx / Assistant.tsx | Hoist unsubmitted user drafts across navigation; poll real native work and followup projections |
| work.ts / WorkTickets.tsx | Native stages/actions, immutable version-bound reply drafts, pagination and human actions |
| FollowupsPanel.tsx / assistant-state.ts | Finite inventory authorization and explicit single-rule selection; safe draft/request identity |
| api.ts / styles.css | Safe Chinese errors and responsive existing visual system |
| tests/client/work-p1.test.ts | Reply version/attention and retry identity, finite expiry, action authority, event presentation |

Dependencies: Leader-owned WorkTicket/WorkAction/FollowupSnapshot DTOs and authenticated HTTP endpoints. Auto availability is explicitly projected by server; observed candidates are not inferred from mode. Native sessions remain the execution record. Drafts contain only user input, never duplicate ticket state.

Risks: stale attention/version after polling, duplicate requests after lost response, navigation dropping drafts, model offline stopping watches, empty inventory selection becoming wildcard, observe being mislabeled zero-cost. Actual browser/native verification belongs to integrated acceptance, not type/build output.
