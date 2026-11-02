# P0 Checks Context Map

Root task P0-INTEGRATION; candidate75b9088. Allowed scripts, packaging tests, root TypeScript config and workflow only. Leader is concurrently implementing host; it is not modified here. Self-reviewed before this change.

| Files | Change |
| --- | --- |
| verify_preparation.py | Preserve historical preparation constraints while recognizing authorized P0 state; retain identity, traceability, privacy, complete acceptance and upstream core hashes |
| check.mjs / tsconfig.json | Check every owned TypeScript capability and deterministic test, rather than only contracts |
| test.mjs / tests/packaging | Discover all five offline suites serially and scrub inherited model/SSH/GitHub secrets |
| preparation.yml | Immutable action pins; actual install/typecheck/build/tests on Windows, no production or live provider secret |

Vendored original documentation is exempt from project-relative links and formatting policy; its core-source inventory and SHA256 remain mandatory and its license/provenance remain checked. Other source files retain all privacy checks. Declared acceptance cannot become passed without evidence. Native tests execute real local DSH with offline fixtures; this does not imply browser or real model acceptance.
