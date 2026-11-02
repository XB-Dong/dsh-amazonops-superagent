import assert from 'node:assert/strict';
import test from 'node:test';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { Context } from '@deepseek-ai/cordis';
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection';
import { RemoteAccessService } from '@deepseek-ai/dsh-api-remote-access';
import { Auth } from '../../packages/host/auth.ts';
import { installNativeAccess } from '../../packages/host/native-access.ts';

test('native connection admits cookie-authenticated operator and denies owner fallback', async () => {
  const ctx = new Context();
  const connection = new HostConnectionService(ctx, [], { isAuthenticated: () => true } as never);
  const access = new RemoteAccessService(ctx);
  const auth = new Auth('synthetic-access-password');
  const token = auth.login('synthetic-access-password');
  const allowed = new Set(['worker-safe']);
  const dispose = installNativeAccess(ctx, auth, 'http://127.0.0.1:3456', () => allowed);
  const req = new IncomingMessage(new Socket());
  req.method = 'POST'; req.url = '/api';
  req.headers = { host: '127.0.0.1:3456', origin: 'http://127.0.0.1:3456', cookie: `amazonops_session=${token}` };
  try {
    const admission = connection.admit(req);
    assert.ok('peer' in admission);
    if (!('peer' in admission)) return;
    assert.notEqual(admission.peer.principal.kind, 'owner');
    const principal = admission.peer.principal;
    const socketAdmission = connection.admitConnection(req);
    assert.ok('peer' in socketAdmission);
    if ('peer' in socketAdmission) {
      assert.equal(socketAdmission.peer.principal.kind, 'amazonops-operator');
      await socketAdmission.release();
    }
    const decide = (action: string, sessionId?: string) => access.decide({ principal, action: action as never,
      resources: sessionId ? [{ kind: 'session', id: sessionId as never }] : [{ kind: 'global' }] });
    assert.equal(decide('session/page', 'worker-safe').kind, 'allow');
    assert.equal(decide('session/page', 'worker-other').kind, 'deny');
    for (const action of ['settings/describe', 'credentials/list', 'cordis/list', 'session/create', 'session/prompt', 'session/fork', 'session/selectModel']) {
      assert.equal(decide(action, action.startsWith('session/') ? 'worker-safe' : undefined).kind, 'deny');
    }
    const snapshot = access.snapshotFor(principal);
    assert.equal(snapshot.owner, false);
    const indexResponse = { writeHead: () => {}, end: () => {} };
    assert.equal(connection.authorizeIndex(req, indexResponse), true);
    const rows = [{ kind: 'global' as const, name: '__DSH_REMOTE_ACCESS__', value: { owner: true } }];
    ctx.emit('webserver/index-inject', rows);
    assert.equal((rows.at(-1)?.value as { owner: boolean }).owner, false);
    let connectStatus = 0;
    connection.authorizeConnect(req, { writeHead(status) { connectStatus = status; }, end() {} });
    assert.equal(connectStatus, 403);
    allowed.delete('worker-safe'); access.invalidate(principal);
    assert.equal(decide('session/page', 'worker-safe').kind, 'deny');
    assert.deepEqual(connection.admit({ headers: { ...req.headers, origin: 'https://evil.test' } }), { rejection: 403 });
    assert.deepEqual(connection.admit({ headers: { host: '127.0.0.1:3456' } }), { rejection: 401 });
    auth.logout(req);
    assert.equal(decide('session/list').kind, 'deny');
    assert.deepEqual(connection.admit(req), { rejection: 401 });
  } finally { dispose(); req.destroy(); }
});
