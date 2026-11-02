# Native operations client

The DSH client plugin exports `inject` and `apply(ctx)` from index.tsx. It registers `amazonops` in native `main` and `sidebar.panellist` slots; `openSession` uses the native workspace service. It does not mount another React root or start an independent Vite application.

The 13 existing Chinese capability pages plus login/settings are adapted from XB-Dong/ccagent (MIT, copyright XB-Dong). Shared DTOs come only from contracts/model.ts; page implementations import no backend classes. App is presentation, controller owns authentication and business refresh. Business refresh runs after commands/navigation/focus, not a periodic whole-database snapshot. The assistant polls only the small work projection while mounted/visible; closing it never invokes cancel. CSS is scoped to `.amazonops` to avoid modifying the DSH shell.

The API is `/amazonops/api/*`. Assistant submission uses a stable requestId through network failure and a fresh ID after successful submission; rendering reads server WorkSnapshot, not an independent conversation store. A Ticket's result is never a business-task completion. Native sessions can be opened from their server-issued ID.

Build as a browser CommonJS bundle with esbuild (React/react-dom/react/jsx-runtime external), include the emitted CSS, and wrap the exports in the native ModuleLoader entry. Root package declares DSH client inject dependencies `dsh-client-locale`, `dsh-client-ui-renderer`, `dsh-client-ui-layout`, `dsh-client-ui-sidebar`, `dsh-client-ui-workspace`. Actual browser load remains an integration gate.

Checks actually performed: `node --test tests/client/*.test.ts`; `pnpm exec tsc -p packages/client/tsconfig.json`; browser-target esbuild bundling. Migrated 15 pure UI assertions are regression, not claimed TDD. New work-message retry/isolation behavior was tested against an initial implementation: two actual assertion failures (new retry ID; cross-thread/duplicate messages), then both passed after implementation. No product browser or live-model acceptance is claimed by these checks.
