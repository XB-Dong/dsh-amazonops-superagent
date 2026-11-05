/** Launch official DSH with a separate private local home and scrubbed environment. */
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { localPatch } from '../profiles/local.ts';
import { configuredOrigin, migrationSetting, verifyRelease, budgetConfiguration } from '../packages/host/production.ts';

const PROJECT = 'dsh-amazonops-superagent';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function unlinkedPath(path) {
  const ancestors = [];
  for (let entry = resolve(path);; entry = dirname(entry)) {
    ancestors.push(entry);
    if (dirname(entry) === entry) break;
  }
  for (const entry of ancestors.reverse()) {
    let stat;
    try { stat = lstatSync(entry); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) throw new Error('RUNTIME_PATH_LINK_FORBIDDEN');
  }
}
function validateHome(home) {
  // Inspect lexical ancestors before any filesystem operation can follow a junction.
  unlinkedPath(home);
  const visit = path => {
    let stat;
    try { stat = lstatSync(path); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw new Error('RUNTIME_PATH_LINK_FORBIDDEN');
    if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name));
  };
  // Includes settings.json, data/harness, data/superagent and nested state files.
  visit(home);
}
export function loadSettings(home, env = process.env) {
  if (!isAbsolute(home)) throw new Error('AMAZONOPS_HOME must be an absolute directory');
  validateHome(home);
  const path = join(home, 'settings.json');
  if (!existsSync(path)) {
    if (existsSync(home) && readdirSync(home).length) throw new Error('Refusing a non-empty home without this project settings');
    mkdirSync(home, { recursive: true, mode: 0o700 });
    validateHome(home);
    writeFileSync(path, `${JSON.stringify({ project: PROJECT, password: randomBytes(24).toString('base64url'),
      port: 4315, modelAccount: 'test' }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  if (settings.project !== PROJECT || typeof settings.password !== 'string' || settings.password.length < 16) {
    throw new Error('Invalid local project settings');
  }
  const port = Number(env.AMAZONOPS_PORT ?? settings.port ?? 4315);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid AMAZONOPS_PORT');
  const modelAccount = settings.modelAccount ?? 'test';
  if (!['test', 'runtime'].includes(modelAccount)) throw new Error('Invalid model account');
  const publicOrigin = settings.publicOrigin;
  configuredOrigin('http://127.0.0.1', publicOrigin);
  const migrationMode = migrationSetting(settings.migrationMode);
  if(settings.proactiveAutoEnabled!==undefined&&typeof settings.proactiveAutoEnabled!=='boolean')throw new Error('INVALID_AUTO_MODE');
  budgetConfiguration({ ...settings, modelAccount });
  return { ...settings, port, modelAccount, publicOrigin, migrationMode, settingsPath: path };
}

export function scrubEnvironment(env, home, apiKey) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  if (env.HOME !== undefined || process.platform !== 'win32') clean.HOME = home;
  clean.DSH_HOME = join(home, 'data', 'harness');
  if (apiKey) clean.AMAZONOPS_API_KEY = apiKey;
  return clean;
}

export function redactOutput(text, secrets = []) {
  let clean = String(text);
  for (const secret of secrets.filter(Boolean)) clean = clean.split(secret).join('[redacted]');
  return clean.replace(/https?:\/\/[^\s<>"']+/g, value => {
    try {
      const url = new URL(value);
      for (const key of [...url.searchParams.keys()]) if (/^(token|access_token|api_key|key)$/i.test(key)) url.searchParams.delete(key);
      return url.toString();
    } catch { return value.replace(/([?&])(?:token|access_token|api_key|key)=[^&\s]+/gi, '$1[redacted]'); }
  });
}

export function lineWriter(write, secrets) {
  let pending = '';
  return {
    push(chunk) {
      pending += String(chunk);
      const lines = pending.split('\n'); pending = lines.pop() ?? '';
      for (const line of lines) write(`${redactOutput(line, secrets)}\n`);
    },
    flush() { if (pending) write(redactOutput(pending, secrets)); pending = ''; },
  };
}

export function start(options = {}) {
  const env = options.env ?? process.env;
  const root = options.root ?? projectRoot;
  if (env.AMAZONOPS_HOME && !isAbsolute(env.AMAZONOPS_HOME)) throw new Error('AMAZONOPS_HOME must be an absolute directory');
  const home = resolve(env.AMAZONOPS_HOME ?? join(homedir(), '.dsh-amazonops'));
  const fromRoot = relative(resolve(root), home);
  if (fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))) throw new Error('Runtime home must stay outside the repository');
  const settings = loadSettings(home, env);
  for (const file of ['lib/index.js', 'lib/client.js', 'vendor/superagent/lib/index.js', 'vendor/superagent/lib/extension.js']) {
    if (!existsSync(join(root, file))) throw new Error('Build artifacts missing; run node scripts/build.mjs first');
  }
  const apiKey = settings.migrationMode ? undefined : env.AMAZONOPS_API_KEY;
  const releaseIdentity = settings.publicOrigin ? verifyRelease(root) : undefined;
  validateHome(home);
  mkdirSync(join(home, 'data'), { recursive: true, mode: 0o700 });
  validateHome(home);
  mkdirSync(join(home, 'data', 'superagent'), { recursive: true, mode: 0o700 });
  const patch = join(home, `launch-${process.pid}-${randomBytes(6).toString('hex')}.json`);
  validateHome(home);
  writeFileSync(patch, `${JSON.stringify(localPatch({ root, home, password: settings.password,
    port: settings.port, live: !!apiKey, modelAccount: settings.modelAccount,
    publicOrigin: settings.publicOrigin, migrationMode: settings.migrationMode, releaseIdentity,
    runtimePolicy: settings.runtimePolicy, runtimeLimits: settings.runtimeLimits,
    proactiveAutoEnabled:settings.proactiveAutoEnabled===true }), null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  const output = options.stdout ?? (value => process.stdout.write(value));
  const errorOutput = options.stderr ?? (value => process.stderr.write(value));
  const origin = configuredOrigin(`http://127.0.0.1:${settings.port}`, settings.publicOrigin);
  output(`工作台：${origin}/amazonops/login\n登录密码保存在：${settings.settingsPath}\n`);
  const require = createRequire(join(root, 'package.json'));
  const cli = require.resolve('@deepseek-ai/dsh/lib/bin.js');
  validateHome(home);
  const child = (options.spawn ?? spawn)(process.execPath, [cli, 'web', '--patch', patch, '--no-open'],
    { cwd: root, env: scrubEnvironment(env, home, apiKey), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const secrets = [settings.password, apiKey];
  const stdout = lineWriter(output, secrets), stderr = lineWriter(errorOutput, secrets);
  child.stdout?.on('data', chunk => stdout.push(chunk));
  child.stderr?.on('data', chunk => stderr.push(chunk));
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return; cleaned = true;
    if (dirname(resolve(patch)) !== resolve(home)) throw new Error('Unsafe launch patch path');
    unlinkedPath(patch);
    if (existsSync(patch)) unlinkSync(patch);
  };
  const stop = () => child.kill();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  child.once('error', error => { cleanup(); errorOutput(`${redactOutput(error.message, secrets)}\n`); });
  child.once('exit', code => {
    stdout.flush(); stderr.flush(); cleanup();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (!options.spawn) process.exitCode = code ?? 0;
  });
  return { child, home, port: settings.port, cleanup };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { start(); } catch (error) { process.stderr.write(`启动未完成，请检查本机配置或先完成构建（${error.code ?? error.name}）。\n`); process.exitCode = 1; }
}
