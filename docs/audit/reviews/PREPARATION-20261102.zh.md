# 前置规格独立审核与处置

2026-11-02｜独立审核者 /root/prep_review，只读；Leader 为工件作者。发现分析另由 parity_inventory、native_architecture 完成，不混同最终独立审核。

初审准确候选：8d33c5c9b7e23f5f48f9a6857bbc768d43cf7466。审核实际运行 python scripts/verify_preparation.py，退出 0：32 文件、36 本地链接、20 需求组、57 项设计验收，productTests=not_run。

| 发现 | 位置 / 触发 | Leader 处置 | 当前复验 |
| --- | --- | --- | --- |
| PREP-R1 / P2：Source 缺确定性事件准入 | domain-v0.1 的 outbox 接入；上游 core/intake.ts 会给无工单所有者的 Trigger 排 Eval，业务派生或助手回执直接回流可能自触发 | 采纳；增加准入表、过滤派生/回执/tick、非唤醒上下文边界；A17-04 验收 | 修订待独立复验 |
| PREP-R2 / P2：跨 Assignment 无稳定业务操作身份 | 三个写工具没有可信 requestId 来源；重启改 Assignment 后可能产生新业务键 | 采纳；持久 originatingMessageEventId/kind/intentSlot→operationId，绑定 payload、重放回执、新请求区分；A17-05 验收 | 修订待独立复验 |

两项为设计缺口，不是已运行复现的产品故障。Leader 已完成同一准备根任务的第 1 轮修订，累计计数保留；未靠改名或分波清零。修订后 59 项设计验收，仍全部 not_run。

审核范围包括完整复现、真实 SuperAgent 复用、Windows/权限/鉴权/重试、业务/编排/来源/恢复及模型记账和准备停止边界。审核未写文件、安装依赖、运行应用或产品测试、调用模型、读取凭据、访问生产或修改自动任务。
