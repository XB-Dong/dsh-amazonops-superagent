/** Native DSH web overlay. The caller supplies isolated state and built plugin locations. */
export function operationsPatch(stateDir: string, pluginPath?: string): object[] {
  const disabled = ['tool-plugin-manager', 'tool-working-directory', 'tool-bash', 'tool-pwsh', 'tool-jobs',
    'tool-fs', 'tool-fs-search', 'skill-filesystem', 'tool-subagent', 'tool-subagent-control',
    'tool-subagent-list-agents', 'tool-subagent-fork', 'tool-workflow', 'tool-goal', 'tool-todo',
    'tool-web', 'llm-retry', 'session-title-llm', 'plugin-package-inventory-deepseek', 'session-log-deepseek',
    'product-analytics', 'desktop-product-telemetry'];
  const emptyPresets = ['standard', 'ptc', 'minimal', 'cordis'].map(id => ({ id: `preset-${id}`,
    config: { id, name: '受限运营入口', plugins: [] } }));
  const presets = ['worker', 'router'].map(role => ({ id: `dsh-superagent-${role}-preset`,
    name: '@deepseek-ai/dsh-agent-preset', config: { id: `dsh-superagent-${role}`,
      name: role === 'worker' ? '运营执行会话' : '运营分派会话', order: 90,
      plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '你是 cc 的中文运营助手，只使用明确提供的运营工具。' } },
        { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
        { id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true }, config: [
          // W=8192, O=2048: min(W*0.8, W-O-512)=5632 pressure tokens.
          { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', config: {
            headroomTokens: 512, retainTokens: 1024, maxTokens: 1024,
            compactionRetries: 0, maxOverflowRetries: 0,
          } },
        ] },
      ] } }));
  return [
    ...disabled.map(id => ({ id, disabled: true })), ...emptyPresets,
    { id: 'permission', config: { presets: { 'amazonops-operator': { sandbox: 'read-only', approval: 'never',
      name: '受限运营', description: '只允许已注册的运营工具。' } }, defaultPreset: 'amazonops-operator' } },
    { insert: [...presets, ...pluginPath ? [{ id: 'amazonops-superagent', name: pluginPath,
      config: { stateDir, executionMode: 'operations' } }] : []] },
  ];
}
