# SuperAgent 原生复用与适配登记

2026-11-02｜native_architecture Agent 独立只读；上游固定提交见[基线](upstream-baseline.json)。这里只证明源码接缝和问题存在，尚未证明任何版本组合可启动。

## 必须真实复用的链路

保留上游 src/index.ts → app/runtime.ts → core/Engine、Store、SourceRegistry、Assessor、DshExecutor、Outbox/Effects，保留原生 Ticket、Assignment 和 DSH Session。根入口已经导出 core；但 SourceHost、SourceKind、Runtime、KV 等没有独立稳定 extension 子路径，Cookbook 示例在上游源码内扩展，不能称外部插件 API 已全部验证。

## 受控适配清单

| ID | 固定源码证据 | 必要改造 / 后续门槛 |
| --- | --- | --- |
| SP-01 | deployment.ts:87–105、app/setup.ts:79 强制 GitHub repo/CLI/push 权限 | operations mode 不读取/要求 GitHub 身份；GitHub/Feishu 默认不加载；原研发模式语义保留 |
| SP-02 | deployment.ts:13–16 仅 /^\// 绝对路径；infra/environment.ts:89 建 sh shim | 原生 Windows isAbsolute/路径边界；运营不造 Git/shell shim，不修改全局 PATH/Git 环境；目录 prepare 用受控 Node API |
| SP-03 | app/sessions.ts:152 danger-full-access；:61/:263/:292 固定开发工具 | 运营 preset/角色/allowlist 可配置；agent-local cc 工具+单调 guard；新建、恢复、HMR、派工切换一致；默认关闭业务子 Agent |
| SP-04 | executor/dsh.ts:30、:549–575 瞬时失败自动重试 3 次 | 模型/worker 自动续调策略显式设零；outbox 投递重放与付费模型重试分开记账 |
| SP-05 | app/tools/executor.ts:82 报告工具构造读取 GitHub；prompts.ts:145 和 sessions.ts:319–324 编码 Skill | 普通产物报告、运营提示及经验不依赖 GitHub；PR 工具仅研发模式加载 |
| SP-06 | exports 无 source/extension；sources/host.ts、registry.ts 提供内部 seam | 新增最小版本化 extension exports，注册 cc-workbench 来源；禁任意内部深导入；不重写 core |
| SP-07 | DSH host/webserver 无全局认证；SuperAgent 管理面仅本机/Host/Origin 类检查 | 全入口运营认证与能力限制：原生 Remote/stream/附件/会话/管理均要覆盖。原生 ingress/guard seam 尚需实验；必要时单独登记有界 DSH host patch |
| SP-08 | DSH llm/stream 可覆盖实际调用；SuperAgent 角色各有模型调用 | llm/stream durable reserve/settle、身份及账户传播、未知 usage 保守记录，禁止任何角色绕过；关闭 llm-retry 与 worker 重试 |

P0 必须先对 SP-01 至 SP-08 给出实际契约探针和允许变更文件；不允许先堆业务代码再假定接缝可用。若补丁扩大到重写 core 领域规则或 Agent loop，需记录架构偏离、重新评审，不能仍称完整复用。

## 引入方式与版本

建议在执行阶段按固定 SHA 引入 SuperAgent 源码为受控工作区包，保持上游目录/许可/提交来源与逐项 patch manifest；不把 cc 领域代码塞入上游 core。补丁与运营 bundle 分离维护。当前不复制上游代码、不建空产品包。

SuperAgent 依赖开发基线为 DSH 0.2.1-alpha.2 系列/React 18；旧 ccagent 为 0.2.1-rc.3/React 19；本机实际 Node 24.22.1、pnpm 11.25.0。源码参考 SHA 不等于已选择安装包版本。P0 须冻结兼容 lockfile、构建工具和单份客户端 React 图，不能盲取两个最新版本；也不能把旧固定 Node 版本描述成现在的检测结果。

## 可核对来源

- [SuperAgent Runtime](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/runtime.ts)、[部署](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/deployment.ts)、[会话](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/sessions.ts)。
- [执行器](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/executor/dsh.ts)、[Source](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/sources/host.ts)、[扩展 Cookbook](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/008-cookbook.md)。
- [DSH 工具](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/core/tools/README.md)、[Webserver](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/host/webserver/README.md)、[LLM](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/llm/llm/README.md)。
