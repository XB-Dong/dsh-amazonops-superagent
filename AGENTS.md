# Agent Instructions

## Scope and authority

Latest user authorization on 2026-11-02: "启动". Enter the complete local P0 defined in docs/waves/P0/PLAN.md. This supersedes the preparation stop below for local dependency installation, product implementation, necessary offline/browser/live-model tests and new-repository synchronization. Use multi-agent development with isolated writing worktrees and independent review. Do not stop at a plan or foundation-only milestone. Cloud, production, old-project writes/automations and external business effects remain prohibited. Read docs/waves/P0/state.json for current execution; preparation state remains historical.

This is a separate local-only refactoring project. The latest user request on 2026-11-02 authorizes repository creation, feature reorganization and multi-agent SDD/TDD preparation, stopping BEFORE the P0 execution plan. P0, once separately entered, means the entire ccagent refactor and working functional tests. Do not split that promise into a foundation-only P0 and deferred P1/P2. No later waves are authorized or planned here.

Do not start product implementation, dependency installation, model tests, production access, data migration or deployment during preparation. Do not modify the old project, its Git history, credentials, services or automations. Old project authorizations are reference material and do not grant this project cloud access or automatic continuation.

## Read first

Execution rules by frontend, backend, native, integration and independent-review role are in [MULTI-AGENT.zh.md](docs/engineering/MULTI-AGENT.zh.md). Apply these current execution rules after startup authorization; preparation documents remain historical evidence.

Read CONSTITUTION.md, NEXT-WAVES.md, docs/product/REQUIREMENTS.zh.md, docs/preparation/state.json, docs/discovery/upstream-baseline.json and specs/architecture.md before further work. A missing preparation artifact is a pending deliverable, not permission to invent implementation results.

## Engineering

- Use TypeScript for product code; Chinese for product requirements and user reports, English for identifiers, code comments and task execution instructions.
- Use the real upstream SuperAgent Runtime/Engine and DSH native host, not only copied terms, a new agent loop or a renamed SDK proxy. Record every required upstream patch and its ownership.
- Separate business domain rules, persistence, orchestration integration, tools and client pages. Inspect responsibilities near 300 handwritten lines; refactor concrete coupling rather than split by line count.
- Keep infrastructure and business task state separate. Business authorization is checked at execution, including resumed sessions and subagents.
- Preserve exact old delivered behavior, provenance, scope, CAS, idempotency, deletion/revocation and accounting. Candidate features remain candidates.
- Record dated requirement changes before updating the current view. Store any future wave plan at docs/waves/P0/PLAN.md, never in root. Do not create it in this preparation stage.

## Collaboration, SDD and TDD

Before edits, create and self-review a Context Map. The Leader owns shared specs, contracts, integration and state. Read-only discovery and independent review agents are explicitly authorized for this preparation. Agents write only assigned review artifacts if any; concurrent product writers later require separate branches/worktrees.

Every dispatch must have a root task, exact baseline commit, spec/input version, owner, allowed paths, dependencies, observable acceptance, repair/stop conditions and deliverable format. Do not dispatch executable work from placeholders. Separate author self-check from independent review and actual runtime acceptance.

Behavior tests for state, concurrency, calculation, permissions, migration and import/export require real Red/Green where applicable. Preserve commands, environment, exit status and actual output. A dependency or installation failure is not behavioral Red. Documentation preparation checks are not product tests. Never inherit old passing evidence as a new platform pass.

## Privacy, testing and isolation

No credentials, authenticated URLs, real feedback, personal absolute paths, production identities, databases, sessions, generated business Skills or raw evidence in Git, even for a private repository. Use the maintainer GitHub no-reply commit identity. Never import old history or operational backups.

Use synthetic fixtures and offline checks first. Necessary future model tests have no self-imposed cumulative money/request/token allowance; keep actual accounting, timeouts, loop protection and zero automatic retries. This policy does not authorize model calls in preparation. Keep runtime and test accounts separate and do not reset historical usage.

Use a separate local Harness home, data directory, business database and port namespace when execution is later authorized. Do not share writable runtime directories with ccagent. Bind local-only services to loopback; no cloud or production copies without a new explicit scope.

Run python scripts/verify_preparation.py after preparation edits. Report completed/partial/not_run truthfully. Stop after the preparation handoff; do not infer P0 entry from repository creation.
