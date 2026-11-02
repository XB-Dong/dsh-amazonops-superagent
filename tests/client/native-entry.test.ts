import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function entry() {
  const result = await build({ entryPoints: [resolve('packages/client/index.tsx')], bundle: true, write: false,
    platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' },
    plugins: [{ name: 'isolate-panel-registration', setup(builder) {
      builder.onResolve({ filter: /^\.\/App\.tsx$/ }, () => ({ path: 'App', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export function App(){return null}', loader: 'js' }));
    } }] });
  const module = { exports: {} as Record<string, any> };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}
test('native sidebar collapse uses actual owner state and is safe under effect replay and remount', async () => {
  const { requestSidebarCollapse } = await entry();
  let calls = 0;
  let requested = requestSidebarCollapse(false, false, () => calls++);
  assert.equal(calls, 1);
  requested = requestSidebarCollapse(false, requested, () => calls++);
  assert.equal(calls, 1, 'StrictMode replay must not toggle the still-stale expanded prop twice');
  assert.equal(requestSidebarCollapse(true, requested, () => calls++), false);
  assert.equal(requestSidebarCollapse(true, false, () => calls++), false);
  assert.equal(calls, 1, 'already collapsed layout must remain collapsed after reload/HMR');
});
test('native plugin shadows only sidebar and keeps the official frame and worker conversation navigation', async () => {
  const { apply } = await entry();
  const registrations: { options: any; component: any }[] = [];
  const selected: string[] = [], opened: string[] = [];
  const ctx = {
    effect: (start: () => unknown) => start(), locale: { register: () => () => {} },
    layout: { selectPanel: (id: string) => selected.push(id), toggleSidebar() {} },
    uiWorkspace: { openSession: (id: string) => opened.push(id) },
    slots: { inject: (_name: string, callback: () => unknown) => callback(),
      register: (options: unknown, component: unknown) => { registrations.push({ options, component }); return () => {}; } },
  };
  apply(ctx);
  assert.deepEqual(selected, ['amazonops']);
  const sidebar = registrations.find(row => row.options.name === 'sidebar');
  assert.equal(sidebar?.options.priority, -10);
  const rail = renderToStaticMarkup(createElement(sidebar!.component, { collapsed: true, width: 56 }));
  assert.ok(rail.includes('返回cc运营工作台'));
  for (const unavailable of ['插件', '自动化', '新建会话', '添加工作区']) assert.ok(!rail.includes(unavailable));
  assert.ok(!registrations.some(row => row.options.name === 'root'));
  const main = registrations.find(row => row.options.name === 'main');
  main!.component().props.children.props.openSession('trusted-worker');
  assert.deepEqual(opened, ['trusted-worker']);
});
