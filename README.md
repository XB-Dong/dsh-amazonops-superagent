# dsh-amazonops-superagent

基于官方 DeepSeek Harness 与 dsh-superagent-prototype，重新组织并完整复现 ccagent 的中文运营工作台。

本机 P0 已完成：13个中文入口、9个业务工具、真实 SuperAgent 路由/工单/执行器、原生会话、认证、隐私闭包和用量账本。237项离线测试、59项分层验收、两个真实模型场景、独立审核及干净Windows CI均通过。完整状态看 [P0状态](docs/waves/P0/state.json)，细节见[验收报告](docs/testing/EXECUTION-20261102.md)。本轮P0没有变更云服务器、旧 ccagent 和旧自动任务。

2026-11-05：P1 已在原云端入口接替旧 ccagent，完成全量建议与历史登记迁移、公网认证/原生连接、重启持久化和实际备份恢复。运行代码为 `16b2ae1`；每日维护与公开交付正在收口，阶段事实见[P1状态](docs/waves/P1/state.json)和[执行报告](docs/testing/P1-EXECUTION-20261105.zh.md)。仓库已公开，旧版本停止功能维护。

P1 增加了原生工单责任、人工行动与有限期库存跟进：授权后，相关风险变化可以续办同一工单；需要选择时交回人工，草稿仍待确认。唯一缺货复核规则先观察，显示真实 `would_accept`；通过服务端验收闸门后，可为明确选中的库存对象启用窄范围自动接单。实现继续使用官方 Runtime/Engine/Store/Session，15 个上游 core 文件保持原样。

当前双平台 CI 均通过 328 项套件：Windows 327 通过、1 项 Linux 专属跳过；Linux 323 通过、5 项 Windows 专属跳过。必要模型验收使用独立合成数据与账本，65 次请求中 63 次用量核实、2 次未知预留保留。完整分层证据见[执行索引](docs/waves/P1/execution-evidence.json)，生产运维边界见[上线与维护](docs/operations/PRODUCTION.zh.md)。上游仍是研究原型，本项目承担其适配及验证责任。

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

新仓库独立建立，不复制旧 Git 历史；当前为公开仓库。原始反馈、真实运维身份/地址、数据库、会话、凭据和私有证据均不进入Git。
