# dsh-amazonops-superagent

基于官方 DeepSeek Harness 与 dsh-superagent-prototype，重新组织并完整复现 ccagent 的中文运营工作台。

P0 正在本机执行：已实现中文工作台、全部业务领域、真实 SuperAgent 路由/工单/执行器、认证和用量账本。目前继续完成隐私边界、浏览器、真实模型与最终审核验收；完整状态看 [P0状态](docs/waves/P0/state.json)，逐项结果看 [验收矩阵](docs/testing/acceptance.json)。云服务器、旧 ccagent 和旧自动任务保持不动。

项目主体是 TypeScript，页面使用 React，底座是固定版本的官方 DSH 与保留 core 的 SuperAgent 源码。业务能力通过 Source、agent-local 工具与 Skill Provider 装配，不另建对话循环。

## 本机开发

需要 Node 24.22.1、pnpm 11.25.0；在新仓库执行：

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
$env:AMAZONOPS_HOME = 'D:/local-amazonops'
pnpm start
```

默认端口4315，仅监听127.0.0.1。首次启动在独立home生成登录密码，启动输出只给出密码文件路径。未配置 `AMAZONOPS_API_KEY` 时模型离线，确定性业务页面仍可使用；配置后使用官方 DeepSeek Anthropic 接口。凭据只在本机私有环境传递，不放入仓库。测试账户独立记录每次模型请求，失败或未知用量保守留账，零自动模型重试。

`pnpm test` 清洗继承凭据并运行全部离线套件，包括真实原生宿主与本地 SSE 假模型；它不调用收费模型。真实模型验收单独执行并留存实际用量。恢复说明见 [本机恢复](docs/operations/LOCAL-RECOVERY.md)。

入口：[文档导航](docs/README.md)、[业务需求](docs/product/REQUIREMENTS.zh.md)、[工程规则](AGENTS.md)、[开发宪法](CONSTITUTION.md)、[阶段边界](NEXT-WAVES.md)。

新仓库独立建立，不复制旧 Git 历史。GitHub 默认先建私有仓库；未获得公开发布指令前保持私有，并按可公开代码的隐私标准维护。
