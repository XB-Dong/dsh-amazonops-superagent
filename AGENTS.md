# Agent Instructions

## Scope and authority

Latest user authorization on 2026-11-02: "启动". Enter the complete local P0 defined in docs/waves/P0/PLAN.md. This supersedes the preparation stop below for local dependency installation, product implementation, necessary offline/browser/live-model tests and new-repository synchronization. Use multi-agent development with isolated writing worktrees and independent review. Do not stop at a plan or foundation-only milestone. Cloud, production, old-project writes/automations and external business effects remain prohibited. Read docs/waves/P0/state.json for current execution; preparation state remains historical.

This is a separate local-only refactoring project. Complete the entire ccagent refactor and working functional tests in P0; no foundation-only P0 or deferred required P1/P2. Do not modify the old project, its Git history, credentials, services or automations. No cloud access, production migration or deployment is authorized. Preparation-stage stop instructions are historical records in docs/preparation, not the current execution boundary.

## Read first

Execution rules by frontend, backend, native, integration and independent-review role are in [MULTI-AGENT.zh.md](docs/engineering/MULTI-AGENT.zh.md). Apply these current execution rules after startup authorization; preparation documents remain historical evidence.

Read CONSTITUTION.md, NEXT-WAVES.md, docs/product/REQUIREMENTS.zh.md, docs/waves/P0/state.json, docs/discovery/upstream-baseline.json and specs/architecture.md before further work. Preserve historical preparation artifacts and never invent implementation results.

## Engineering

- Use TypeScript for product code; Chinese for product requirements and user reports, English for identifiers, code comments and task execution instructions.
- Use the real upstream SuperAgent Runtime/Engine and DSH native host, not only copied terms, a new agent loop or a renamed SDK proxy. Record every required upstream patch and its ownership.
- Separate business domain rules, persistence, orchestration integration, tools and client pages. Inspect responsibilities near 300 handwritten lines; refactor concrete coupling rather than split by line count.
- Keep infrastructure and business task state separate. Business authorization is checked at execution, including resumed sessions and subagents.
- Preserve exact old delivered behavior, provenance, scope, CAS, idempotency, deletion/revocation and accounting. Candidate features remain candidates.
- Record dated requirement changes before updating the current view. Maintain the authorized P0 plan at docs/waves/P0/PLAN.md, never in root.

## Collaboration, SDD and TDD

Before edits, create and self-review a Context Map. The Leader owns shared specs, contracts, integration and state. Discovery, implementation and independent review agents are explicitly authorized. Agents write only assigned paths; concurrent product writers require separate branches/worktrees.

Every dispatch must have a root task, exact baseline commit, spec/input version, owner, allowed paths, dependencies, observable acceptance, repair/stop conditions and deliverable format. Do not dispatch executable work from placeholders. Separate author self-check from independent review and actual runtime acceptance.

Behavior tests for state, concurrency, calculation, permissions, migration and import/export require real Red/Green where applicable. Preserve commands, environment, exit status and actual output. A dependency or installation failure is not behavioral Red. Documentation preparation checks are not product tests. Never inherit old passing evidence as a new platform pass.

## Privacy, testing and isolation

No credentials, authenticated URLs, real feedback, personal absolute paths, production identities, databases, sessions, generated business Skills or raw evidence in Git, even for a private repository. Use the maintainer GitHub no-reply commit identity. Never import old history or operational backups.

Use synthetic fixtures and offline checks first. Necessary model tests have no self-imposed cumulative money/request/token allowance; keep actual accounting, timeouts, loop protection and zero automatic retries. Keep runtime and test accounts separate and do not reset historical usage.

Use a separate local Harness home, data directory, business database and port namespace. Do not share writable runtime directories with ccagent. Bind local-only services to loopback; no cloud or production copies without a new explicit scope.

Run node scripts/check.mjs, node scripts/build.mjs, node scripts/test.mjs and python scripts/verify_preparation.py as appropriate. Report completed/partial/not_run truthfully. Complete current authorized work; preserve the local-only boundary.
