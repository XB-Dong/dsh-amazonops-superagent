/** Concrete local overlay; private credentials are supplied only in the private launch file. */
import { join } from 'node:path';
import { operationsPatch } from './operations.ts';

export interface LocalProfile {
  root: string;
  home: string;
  password: string;
  port: number;
  live: boolean;
  modelAccount: 'test' | 'runtime';
}

export function localPatch(options: LocalProfile): object[] {
  const path = (...parts: string[]) => join(...parts).replaceAll('\\', '/');
  const stateDir = path(options.home, 'superagent');
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
        live: options.live, modelAccount: options.modelAccount } },
      { id: 'amazonops-superagent', name: path(options.root, 'vendor/superagent/lib/index.js'),
        config: { stateDir, executionMode: 'operations' } },
    ] },
  ];
}
