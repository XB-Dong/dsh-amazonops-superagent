import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildProject } from '../../scripts/build.mjs';

test('native client factory installs scoped CSS including imports and remains idempotent', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'amazonops-native-styles-'));
  const outDir = join(fixture, 'application');
  await buildProject({ root: resolve('.'), outDir });
  type Style = { dataset: Record<string, string>; textContent: string };
  const styles: Style[] = [];
  const document = {
    querySelector: (selector: string) => styles.find(style =>
      selector === `style[data-plugin-css=${JSON.stringify(style.dataset.pluginCss)}]`) ?? null,
    createElement: (tag: string): Style => {
      assert.equal(tag, 'style'); return { dataset: {}, textContent: '' };
    },
    head: { appendChild: (style: Style) => styles.push(style) },
  };
  let factory: ((require: NodeJS.Require) => unknown) | undefined;
  runInNewContext(readFileSync(join(outDir, 'client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load: (module: { id: string; factory: typeof factory }) => {
      assert.equal(module.id, 'dsh-amazonops-superagent'); factory = module.factory;
    } } }, document, console,
  });
  assert.ok(factory);
  const require = createRequire(import.meta.url);
  factory(require);
  assert.equal(styles.length, 5, 'Executing the native module must install all five directly imported stylesheets');
  assert.equal(new Set(styles.map(style => style.dataset.pluginCss)).size, 5);
  for (const style of styles) assert.equal(style.dataset.plugin, 'dsh-amazonops-superagent');
  const mainStyle = styles.find(style => style.dataset.pluginCss.endsWith('/styles.css'))!;
  const css = mainStyle.textContent;
  assert.ok(css.includes('Segoe UI'));
  assert.match(css, /\.amazonops\s*\{[^}]*background:#f7f9f8/);
  assert.match(css, /\.amazonops \.primary\s*\{[^}]*background:#1b6d5b/);
  assert.match(css, /\.amazonops \.app-shell\s*\{[^}]*display:flex/, '@import workspace.css must be bundled');
  assert.equal(css.includes('@import'), false, 'Native CSS must not rely on unresolved CSS imports');
  mainStyle.textContent = 'stale-css';
  factory(require);
  assert.equal(styles.length, 5, 'Repeated module factory execution must reuse the official style identities');
  assert.equal(mainStyle.textContent, css, 'Reloaded module must replace stale CSS');
  const audit = readFileSync(join(outDir, 'client.css'), 'utf8');
  for (const style of styles) assert.ok(audit.includes(style.textContent), 'Audit CSS contains every injected payload');
});
