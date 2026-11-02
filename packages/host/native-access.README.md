# Native access adaptation

P0-ACCESS, spec v0.2.0; self-reviewed extension to the P0 host Context Map. Only native-access.ts, its targeted integration test and this note are owned here. Existing Auth and remote/native services remain owned by the Leader/upstream.

Install after `connection` and `remoteAccess` are provided, with the product Auth and exact origin:

```ts
const dispose = installNativeAccess(ctx, auth, origin, scope => workerSessionIdsFor(scope));
```

Uses real rc.3 `HostConnectionService.createPeer` and `RemoteAccessService.registerPolicy`. `connection.admit`, `authorizeIndex` and `authorizeConnect` are bounded instance adaptations, not class-wide monkey patches. Native HTTP registrations and `admitConnection` delegate dynamically to admit. Browser owner credentials and launch-token `/connect` never provide a product operator identity. A per-authentication non-owner principal carries only random subject and scope, never a credential. Each policy evaluation rechecks live Auth, so logout/expiry deny existing RPC streams on their next guarded item. Logout revokes peers; a periodic grant fingerprint triggers snapshot invalidation for changed whitelist/expiry, not unconditional invalidation.

Global grants are only session/workspace read collections. Per-session grants require the current worker-session whitelist and permit list/control filtering, page/follow/projections and corresponding session events. No global grant falls back to session authorization. Mutating native session calls and all settings/credentials/plugins/commands/files remain denied by default. Business commands continue through the separately authenticated product routes.

Index injections replace the owner display baseline with `snapshotFor(operator)`; a final index transform replaces any later owner baseline assignment too. This baseline is UI metadata, never a server permission. Index selection uses the current authorized index principal, consistent with the product's single cc/main identity. Do not extend this renderer to multiple human scopes without a request-scoped render contract. Shut down ingress before disposing this adaptation, since disposal restores the original upstream instance methods.

Tests use actual Cordis Context, native HostConnectionService/Peer and RemoteAccessService with Node IncomingMessage, plus the product Auth. The upstream BrowserAuth is deliberately an owner-allowing fixture to prove no fallback survives. They are service-level integration checks, not full HTTP/WS/browser acceptance. Initial actual Red was the original owner principal; fixed policy passed Green. Raw results are in private support evidence/access. Leader must still verify native HTML, HTTP and WebSocket end-to-end in the full host.
