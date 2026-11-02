/** Build the actual native vendor, host bundle and shared-React native client. */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildProject(options = {}) {
  const root = options.root ?? projectRoot;
  const outDir = options.outDir ?? join(root, 'lib');
  const nativeDir = join(root, 'vendor/superagent/lib');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(nativeDir, { recursive: true });
  const common = { bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', logLevel: 'warning' };
  await build({ ...common, entryPoints: [join(root, 'vendor/superagent/src/extension.ts')], outfile: join(nativeDir, 'extension.js') });
  await build({ ...common, entryPoints: [join(root, 'vendor/superagent/src/index.ts')], outfile: join(nativeDir, 'index.js') });
  const nativeExternal = { name: 'native-superagent-boundary', setup(builder) {
    builder.onResolve({ filter: /vendor[\\/]superagent[\\/]src[\\/]/ }, args => {
      const name = /(?:^|[\\/])(extension|index)\.ts$/.exec(args.path)?.[1];
      if (!name) return { errors: [{ text: 'Host must import the versioned SuperAgent extension, not vendor internals.' }] };
      let path = relative(outDir, join(nativeDir, `${name}.js`)).replaceAll('\\', '/');
      if (isAbsolute(path)) path = pathToFileURL(path).href;
      else if (!path.startsWith('.')) path = `./${path}`;
      return { path, external: true };
    });
  } };
  await build({ ...common, entryPoints: [options.hostEntry ?? join(root, 'packages/host/index.ts')],
    outfile: join(outDir, 'index.js'), plugins: [nativeExternal] });
  const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
  await build({ entryPoints: [options.clientEntry ?? join(root, 'packages/client/index.tsx')],
    outfile: join(outDir, 'client.js'), bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
    jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'], logLevel: 'warning',
    banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
    footer: { js: 'return module.exports;}});' },
  });
  const outputs = ['index.js', 'client.js', 'client.css'].map(path => {
    const bytes = readFileSync(join(outDir, path));
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const manifest = { schemaVersion: '0.2', sourceSha: git('rev-parse', 'HEAD'),
    sourceDirty: git('status', '--porcelain').length > 0,
    superagentSha: JSON.parse(readFileSync(join(root, 'vendor/superagent/UPSTREAM.json'), 'utf8')).sha,
    builtAt: new Date().toISOString(), artifacts: outputs };
  writeFileSync(join(outDir, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildProject().then(result => {
    process.stdout.write(`Built native SuperAgent, host and client (${result.artifacts.length} application artifacts).\n`);
  }).catch(error => { process.stderr.write(`Build failed: ${error.message}\n`); process.exitCode = 1; });
}
