# Native operations adaptation

Upstream: deepseek-ai/dsh-superagent-prototype at 6337fc823ce20251c8de8085948165c81aaa701e (MIT). Original Runtime, Engine, Store, Effects, Assessor, DshExecutor, Ticket and Assignment implementations remain in use. No replacement agent loop is introduced.

## Versioned integration

Build `src/extension.ts` to `lib/extension.js` as Node ESM with external packages. Keep this output under this vendor package so `infra/paths.ts` finds packaged prompt and skill assets. The main host should import the extension build separately instead of inlining it into an unrelated root bundle.

The extension exports Runtime/OperationsExtensions, Config/machineOf, SourceKind/SourceHost, Tool, Store, core types and typed KV helpers. `ctx.orchestrator` remains the actual Runtime service. The entry reads an optional `amazonopsHooks` service with `tools(agent,ticket)` and `onAgent(agent,ticket)` callbacks and passes it to Runtime. A business plugin must not import arbitrary vendor internals.

`profiles/operations.ts` composes an overlay for the official `dsh web` launcher. It constrains ordinary presets, creates managed router/worker presets, defines the read-only `amazonops-operator` permission, disables filesystem/shell/delegation and automatic retry tools, and can insert the built native entry. Each caller supplies isolated state and home paths.

## Bounded changes

| Seam | Adaptation |
| --- | --- |
| Deployment/setup | explicit operations mode bypasses GitHub CLI/accounts and OS environment shims; native Windows absolute paths |
| Session policy | managed operations permission, strict inherited tool mask and final monotonic tool guard; local business tools use the same guard; subagents disabled |
| Prompts/reporting | neutral Chinese routing/operations instructions, no bundled GitHub/Feishu skills, no PR construction dependency or operations-mode management routes |
| Executor | Node-only directory preparation in operations mode; model failure retry limit zero; durable internal delivery replay retained |
| Extension | optional business tools/agent decoration callbacks, narrow explicit exports; no business imports into upstream core |
| JSON schema compatibility | strip Zod non-enumerable Standard Schema functions through JSON schema serialization before DSH registration |
| Agent preset compatibility | isolate compaction service inside each preset realm |

The host owner is still responsible for authenticated source admission, trusted operation identity, scope, business guards, all-route authentication and accounting at `llm/stream`. This vendor adaptation does not claim those integration gates passed merely because startup works.

## Actual validation

`node --experimental-transform-types --test tests/native/native-startup.test.ts tests/native/operations-policy.test.ts` passed 5 tests on native Windows / Node 24.22.1 / DSH rc.3. The native test launches the official Web profile in an isolated temporary home, mounts the real upstream Runtime/Engine/Store/DshExecutor, creates the actual router Session, checks durable permission selection, attempts a locally registered forbidden shell tool and verifies its body never runs, and probes the executor's real retry decision for HTTP 503 as zero.

Windows path and operations-without-GitHub behavior first failed against unadapted source, then passed. Strip-only TypeScript loading initially rejected upstream parameter properties; this was an environment loader failure, not behavioral Red. Compaction realm and lossless JSON schema failures were real native compatibility probes and are not claimed as domain TDD.

All model endpoints in these startup tests point to an unavailable loopback address; startup performs no paid request. This is actual native startup and tool-policy verification, not full business or live-model acceptance. Frontend loading, complete source/worker business flow, data restore and production remain separately verified by their owners.
