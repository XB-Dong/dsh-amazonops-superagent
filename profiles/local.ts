/** Concrete local overlay; private credentials are supplied only in the private launch file. */
import { join } from 'node:path';
import { operationsPatch } from './operations.ts';
import type { ReleaseIdentity, RuntimeProtection } from '../packages/host/production.ts';

export interface LocalProfile extends RuntimeProtection {
  root: string;
  home: string;
  password: string;
  port: number;
  live: boolean;
  modelAccount: 'test' | 'runtime';
  publicOrigin?: string;
  migrationMode?: boolean;
  proactiveAutoEnabled?: boolean;
  releaseIdentity?: ReleaseIdentity;
}

export function localPatch(options: LocalProfile): object[] {
  const path = (...parts: string[]) => join(...parts).replaceAll('\\', '/');
  const stateDir = path(options.home, 'data', 'superagent');
  return [
    ...operationsPatch(stateDir),
    { id: 'webserver', config: { host: '127.0.0.1', port: options.port } },
    { id: 'llm-deepseek', config: { apiKeyEnv: 'AMAZONOPS_API_KEY', baseURL: 'https://api.deepseek.com/anthropic',
      thinking: 'disabled', reasoningEffort: 'off', defaultContextWindow: 8192, maxTokens: 2048,
      streamIdleTimeoutMs: 45000, retryPolicy: { mode: 'normal', maxRetries: 0 },
      models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash', contextWindow: 8192, maxTokens: 2048 }] } },
    { insert: [
      { id: 'amazonops-host', name: path(options.root, 'lib/index.js'), config: {
        dataDir: path(options.home, 'data'), password: options.password,
        live: options.live && !options.migrationMode, modelAccount: options.modelAccount,
        publicOrigin: options.publicOrigin, migrationMode: options.migrationMode ?? false,
        releaseIdentity: options.releaseIdentity, runtimePolicy: options.runtimePolicy, runtimeLimits: options.runtimeLimits,
        proactiveAutoEnabled: options.proactiveAutoEnabled===true } },
      ...!options.migrationMode ? [{ id: 'amazonops-superagent', name: path(options.root, 'vendor/superagent/lib/index.js'),
        config: { stateDir, executionMode: 'operations' } }] : [],
    ] },
  ];
}
