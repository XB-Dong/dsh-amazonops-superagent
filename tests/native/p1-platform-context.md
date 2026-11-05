# P1 Platform Context Map

Baseline f6a2a62feff5fac95f30077b537cbbb94679313f, spec0.3.0. Self-reviewed before edits. Product writes confined to assigned platform paths; host/index.ts integration belongs to Leader.

## Files to Modify

| File | Purpose | Changes Needed |
| --- | --- | --- |
| scripts/start.mjs / profiles/local.ts | Private launcher/profile | Validate canonical publicOrigin and migrationMode, carry verified release identity, isolate Linux HOME, hard-disable model in migration |
| packages/host/production.ts / boundary.ts | Production helpers and HTTP fence | Explicit origin, Secure cookies, minimal version health, read-only migration requests, anonymous exact health/readiness routes |
| scripts/build.mjs | Release identity | Add immutable complete artifact manifest without private paths, preserve existing build-manifest consumers |
| deploy/** / .github/workflows/preparation.yml | Service and CI | Restricted systemd/Caddy examples, Linux plus Windows native checks |
| tests/native/production.test.ts / production-related tests | Behavior | Invalid settings, Linux environment isolation, complete release validation, proxy-header fences and migration read policy |

## Dependencies (may need updates)

Leader wires host/index.ts to production helpers and controls ticks, Source and routes. Existing localPatch, Auth, native-access, release outputs and pinned DSH remain shared constraints. Product processes never receive developer GitHub/SSH configuration.

## Test Files

Existing packaging.test.ts, boundary.test.ts, native-startup.test.ts and Windows workspace tests remain regressions. Add actual behavior tests before implementation; no model/network/cloud calls. Linux commands run later in isolated host/CI and are not claimed by Windows evidence.

## Reference Patterns

Private launcher link refusal, existing native boundary exact Host/Origin, pinned DSH process tests, current complete test discovery.

## Risk Assessment

- [x] Config and HTTP ingress changes; preserve loopback and exact authority.
- [x] Complete manifest must validate bytes and paths, no unverified environment SHA.
- [x] Migration mode cannot enable model/bootstrap or writer operations.
- [x] No database migration in this task.
