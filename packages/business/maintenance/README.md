# Private maintenance inspection

This module implements the actual read-only P1 handover inspection. It does not update an automation, call a model, allocate a wave, develop code or deploy. `canDevelop: false` means the checker grants no development authority; the Leader's separately recorded human authorization remains the only basis for later work.

## API

`initializeMaintenance({ data, registry, authority, owner, destination })` creates a new private baseline file. It records full current `main` feedback fingerprints, tombstones, pending capture jobs and their source records, plus the original private registry's hash and historical ID/revision/decision map. It never overwrites an existing destination or changes the old registry. Initialize against the final migrated production root after G2, not a differently located rehearsal copy.

`checkMaintenance({ data, registry, authority, owner, state, mode, output })` reads the new production root and compares it with that baseline. `mode` is `handover_validation` or `daily`. It requires an existing valid state bound to the physical data root and writes a new private report. All input DB/WAL/SHM, registry, lease and baseline bytes remain unchanged.

Feedback uses complete canonical payload fingerprints, so changed count, sources, pending supplements, status or same-revision revocation are observable. Complete ID sets detect disappearance and reappearance. Withdrawn/deleted/duplicate historical reappearance is marked as an integrity finding, never a newly approved feature. Pending capture sources are included only when linked to a currently pending/running/retrying capture job; resolved user messages and derived tool messages do not create new feedback work. Removal of resolved capture work is reported but does not by itself make a check actionable.

An unresolved capture job is reported as `pendingCaptureOutstanding`, including when it already existed at initialization. Initialization is not proof that queued suggestions were extracted or handled. Such a queue keeps inspection actionable until the actual product consumer drains it; the checker itself never drains it or grants permission to start a development wave.

Registry decision changes are actionable; registry `lastCheckedAt` or other bookkeeping-only byte changes are informational. Privacy-ledger changes and tombstone changes remain actionable. Reports expose no plaintext feedback, although private IDs and fingerprints are retained in the private report. CLI stdout contains only aggregate counts.

`nextSnapshot` in the private report is a candidate for a future accepted baseline. The checker never advances its baseline automatically. The authorized Leader may initialize a new immutable state file only after recording classification/delivery/revocation decisions and preserving all private history; then explicitly switch the private state pointer. An unchanged pending decision does not authorize a new wave.

## Per-run authority lease

The operator first checks persistent production authority and exclusive Leader ownership, then writes a fresh private lease:

```json
{
  "project": "dsh-amazonops-superagent",
  "productionActive": true,
  "legacyMaintenanceStopped": true,
  "ownerThreadId": "current-thread",
  "businessDelivery": "handover",
  "expiresAt": "2026-11-05T12:30:00.000Z"
}
```

The example time is not a reusable lease. The real expiration must be in the future and at most one hour from the check. `owner` must match the lease. `handover_validation` permits `handover` or `completed`; normal `daily` requires `completed`. The helper validates the operator's lease, not the process table or scheduler itself. A fresh per-run lease is distinct from the long-lived production-generation record and does not require new user approval or credential rotation. A missing, expired, wrong-owner or inactive-production lease fails closed.

## CLI

Replace the uppercase arguments with private paths and the actual owning thread:

```text
node --experimental-transform-types scripts/maintenance.ts init --data DATA --registry REGISTRY --authority LEASE --owner THREAD --destination NEW_STATE
node --experimental-transform-types scripts/maintenance.ts check --data DATA --registry REGISTRY --authority LEASE --owner THREAD --state STATE --mode handover_validation --output NEW_REPORT
node --experimental-transform-types scripts/maintenance.ts check --data DATA --registry REGISTRY --authority LEASE --owner THREAD --state STATE --mode daily --output NEW_REPORT
```

State and report outputs must be new files outside Git repositories and outside input trees; linked paths are refused. Only private copies of DB/WAL are opened. A before/after byte check rejects concurrent source changes instead of pretending they were a stable snapshot. The operator may repeat a failed check with a fresh output path after checking the cause; there is no unbounded internal retry.

Successful handover inspection is evidence that this inspection path ran. It does not prove that the scheduler fired. Automation configuration/readback and the first actual scheduled run must be reported separately by the Leader.
