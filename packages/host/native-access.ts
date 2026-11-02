import type { Context } from '@deepseek-ai/cordis';
import { randomUUID } from 'node:crypto';
import type { ConnectionTrustRequest, HostConnectionService, PeerScope, Principal } from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-client-connection';
import { REMOTE_ACCESS_SNAPSHOT_KEY, type RemoteAccessBinding } from '@deepseek-ai/dsh-api-remote-access';
import type {} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type { Auth } from './auth.ts';
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    'amazonops-operator': { readonly kind: 'amazonops-operator'; readonly subject: string; readonly scope: string };
  }
}
type Operator = Extract<Principal, { kind: 'amazonops-operator' }>;
type Record = { cookie: string; peer: PeerScope; principal: Operator };
const globalActions = ['session/list', 'session/control', 'workspace/list', 'workspace/follow'] as const;
const sessionActions = ['session/list', 'session/control', 'session/page', 'session/follow', 'session/projections',
  'event:api-session/added', 'event:api-session/removed', 'event:api-session/status'] as const;
function header(request: ConnectionTrustRequest, key: string): string | undefined {
  if (request.headers instanceof Headers) return request.headers.get(key) ?? undefined;
  const value = request.headers[key];
  return typeof value === 'string' ? value : undefined;
}
export function installNativeAccess(ctx: Context, auth: Auth, origin: string, sessionsForScope: (scope: string) => ReadonlySet<string>): () => void {
  const connection = ctx.connection as HostConnectionService;
  if (typeof connection.authorizeConnect !== 'function' || typeof connection.admit !== 'function') throw new Error('NATIVE_CONNECTION_CONTRACT_CHANGED');
  const access = ctx.remoteAccess;
  const authority = new URL(origin).host;
  const records = new Map<string, Record>();
  const subjects = new Map<string, Record>();
  const denied: Operator = { kind: 'amazonops-operator', subject: 'unauthenticated', scope: 'main' };
  let indexPrincipal: Operator = denied;
  let disposed = false;
  let lastGrants = '';
  const live = (record: Record) => auth.identity({ headers: { cookie: record.cookie } })?.scope === record.principal.scope;
  const removePolicy = access.registerPolicy('amazonops-operator', {
    bindings(principal): RemoteAccessBinding[] {
      const record = subjects.get(principal.subject);
      if (disposed || !record || !live(record) || principal.scope !== record.principal.scope) return [];
      return [
        { resource: { kind: 'global' }, role: { name: 'operator-collections', resource: 'global', actions: globalActions } },
        ...[...sessionsForScope(principal.scope)].map((id): RemoteAccessBinding => ({
          resource: { kind: 'session', id: id as never },
          role: { name: 'operator-ticket-session-read', resource: 'session', actions: sessionActions },
        })),
      ];
    },
    explain: () => 'operator-access-denied',
  });
  const original = { admit: connection.admit, index: connection.authorizeIndex, connect: connection.authorizeConnect, logout: auth.logout };
  connection.admit = (request) => {
    if (disposed) return { rejection: 401 };
    if (header(request, 'host') !== authority) return { rejection: 403 };
    const requestOrigin = header(request, 'origin');
    const method = (request as { method?: string }).method;
    if ((requestOrigin && requestOrigin !== origin) || (method && !['GET', 'HEAD'].includes(method) && requestOrigin !== origin)) return { rejection: 403 };
    const cookie = header(request, 'cookie');
    const identity = auth.identity({ headers: { cookie } });
    if (!identity || !cookie) return { rejection: 401 };
    let record = records.get(cookie);
    if (!record) {
      const principal: Operator = { kind: 'amazonops-operator', subject: randomUUID(), scope: identity.scope };
      record = { cookie, principal, peer: connection.createPeer({ principal, interactions: 'answer' }) };
      records.set(cookie, record); subjects.set(principal.subject, record);
      access.invalidate(principal);
    }
    return { peer: record.peer };
  };
  connection.authorizeIndex = (request, response) => {
    const admitted = connection.admit(request);
    if ('rejection' in admitted) {
      indexPrincipal = denied;
      response.writeHead(admitted.rejection, { 'cache-control': 'no-store' }); response.end('unauthorized');
      return false;
    }
    indexPrincipal = admitted.peer.principal as Operator;
    return true;
  };
  connection.authorizeConnect = (_request, response) => {
    response.writeHead(403, { 'cache-control': 'no-store' }); response.end('forbidden');
  };
  const revoke = () => {
    for (const [cookie, record] of records) {
      if (!live(record)) { records.delete(cookie); subjects.delete(record.principal.subject); void record.peer.dispose(); }
    }
    const grants = JSON.stringify([...records.values()].map((record) =>
      [record.principal.subject, [...sessionsForScope(record.principal.scope)].sort()]));
    if (grants !== lastGrants) { lastGrants = grants; access.invalidate(); }
  };
  auth.logout = (request) => { original.logout.call(auth, request); revoke(); };
  // Index injection is a display baseline only; each RPC remains peer-authorized.
  const removeInjection = ctx.on('webserver/index-inject', (table) => {
    for (let i = table.length - 1; i >= 0; i--) {
      const row = table[i];
      if (row.kind === 'global' && row.name === REMOTE_ACCESS_SNAPSHOT_KEY) table.splice(i, 1);
    }
    table.push({ kind: 'global', name: REMOTE_ACCESS_SNAPSHOT_KEY, value: access.snapshotFor(indexPrincipal) });
  });
  const removeTap = ctx.get('webServer')?.tapIndex((html) => {
    const baseline = JSON.stringify(access.snapshotFor(indexPrincipal)).replaceAll('<', '\\u003c');
    return html.replace(/globalThis\["__DSH_REMOTE_ACCESS__"\]\s*=\s*[^<]*<\/script>/g,
      `globalThis["__DSH_REMOTE_ACCESS__"] = ${baseline}</script>`);
  });
  const timer = setInterval(revoke, 1000); timer.unref();
  return () => {
    if (disposed) return;
    disposed = true; clearInterval(timer); removeInjection(); removeTap?.(); removePolicy();
    connection.admit = original.admit; connection.authorizeIndex = original.index;
    connection.authorizeConnect = original.connect; auth.logout = original.logout;
    for (const record of records.values()) void record.peer.dispose();
    records.clear(); subjects.clear();
  };
}
