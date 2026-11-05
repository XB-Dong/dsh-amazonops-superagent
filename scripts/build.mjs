/** Build the actual native vendor, host bundle and shared-React native client. */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
  const styles = new Map();
  // DSH loads the JavaScript module only. Match its official CSS-to-JS installation seam.
  const nativeStyles = { name: 'native-plugin-styles', setup(builder) {
    builder.onLoad({ filter: /\.css$/ }, async args => {
      const compiled = await build({ entryPoints: [args.path], bundle: true, write: false,
        outfile: 'plugin.css', minify: true, target: 'es2022', logLevel: 'warning', metafile: true });
      if (compiled.outputFiles.length !== 1 || !compiled.outputFiles[0].path.endsWith('.css')) {
        throw new Error('Native plugin CSS must be self-contained');
      }
      const css = compiled.outputFiles[0].text;
      const tagId = `${name}/${relative(root, args.path).replaceAll('\\', '/')}`;
      styles.set(tagId, css);
      return { loader: 'js', watchFiles: Object.keys(compiled.metafile.inputs).map(path => resolve(path)), contents: `
        const tagId = ${JSON.stringify(tagId)};
        if (typeof document !== 'undefined') {
          const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']');
          const tag = existing ?? document.createElement('style');
          tag.dataset.plugin = ${JSON.stringify(name)};
          tag.dataset.pluginCss = tagId;
          tag.textContent = ${JSON.stringify(css)};
          if (!existing) document.head.appendChild(tag);
        }` };
    });
  } };
  await build({ entryPoints: [options.clientEntry ?? join(root, 'packages/client/index.tsx')],
    outfile: join(outDir, 'client.js'), bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
    jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'], logLevel: 'warning',
    plugins: [nativeStyles],
    banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
    footer: { js: 'return module.exports;}});' },
  });
  // Keep an audit artifact; browser loading is owned by the native JS factory.
  writeFileSync(join(outDir, 'client.css'), [...styles].sort(([a], [b]) => a.localeCompare(b)).map(([, css]) => css).join('\n'));
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
  const files = [];
  function collect(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Release input must not be a symbolic link');
      const path = join(directory, entry.name), label = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) collect(path, label);
      else files.push([label, path]);
    }
  }
  for (const path of ['index.js', 'client.js', 'client.css']) files.push([`lib/${path}`, join(outDir, path)]);
  for (const path of ['index.js', 'extension.js']) files.push([`vendor/superagent/lib/${path}`, join(nativeDir, path)]);
  for (const path of ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'THIRD-PARTY-NOTICES.md',
    'vendor/superagent/package.json', 'vendor/superagent/LICENSE', 'vendor/superagent/UPSTREAM.json', 'vendor/superagent/patch-manifest.json'])
    files.push([path, join(root, path)]);
  for (const directory of ['profiles', 'patches', 'scripts', 'packages',
    'vendor/superagent/prompts', 'vendor/superagent/skills']) collect(join(root, directory), directory);
  const release = { schemaVersion: '0.3', sourceSha: manifest.sourceSha, sourceDirty: manifest.sourceDirty,
    superagentSha: manifest.superagentSha, builtAt: manifest.builtAt,
    artifacts: files.sort(([a], [b]) => a.localeCompare(b)).map(([path, file]) => {
      const bytes = readFileSync(file);
      return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }) };
  writeFileSync(join(outDir, 'release-manifest.json'), `${JSON.stringify(release, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildProject().then(result => {
    process.stdout.write(`Built native SuperAgent, host and client (${result.artifacts.length} application artifacts).\n`);
  }).catch(error => { process.stderr.write(`Build failed: ${error.message}\n`); process.exitCode = 1; });
}
