# 已实现的 P0 架构

2026-11-02。实现结果及运行证据见[验收报告](../testing/EXECUTION-20261102.md)，当前总状态以[P0状态](../waves/P0/state.json)为准。

项目主体为 TypeScript；中文工作台使用 React，宿主采用 DSH `0.2.1-rc.3`。SuperAgent 固定到 `6337fc823ce20251c8de8085948165c81aaa701e`，保留上游许可证，15 个 core 文件的字节哈希未变。所需改动集中在宿主、执行器、权限和扩展接缝，清单见[补丁记录](../../vendor/superagent/patch-manifest.json)。DSH 客户端的只读入口改动通过 pnpm patch 固定。

## 能力装配

| 层 | 实际责任与权威 |
| --- | --- |
| SuperAgent Runtime / Engine / Store / Effects | 接收 Source、路由、Ticket、Assignment、持久 effect 和 outbox；使用真实上游对象 |
| DSH Sessions / agent-loop / persistence | 会话、流式事件、工具回调、压缩、取消和恢复；原生 Session 是新对话唯一权威 |
| `packages/host` | 认证与 Origin、可信 scope、原生 Source/Channel、agent-local 工具、Skill Provider、隐私 epoch、模型账本及协调 checkpoint |
| `packages/business` | Command/Query、领域规则、SQLite、CAS、幂等回执、来源引用、删除撤销、导入导出；不拥有模型循环 |
| `packages/contracts` | 共享 DTO；不依赖数据库、React 或领域实现 |
| `packages/client` | 原生客户端 slot 下的中文页面；高级执行视图打开官方 Session，复用宿主 React |

只有认证后的 `human_request` 可以进入 Source。普通业务事件、后台 tick、反馈捕获、助手投递和工具回执不会再进入模型 Eval。master 仅有 `orchestrator_route`、`orchestrator_reply`；worker 的原生编排工具与业务工具按 Ticket 注入，shell、文件、安装、凭据和管理工具不在运营会话授权内。

## 业务工具

| 工具 | 业务责任 |
| --- | --- |
| `cc_read_operations` | 读取有来源、日期、scope 和截断元数据的运营摘要 |
| `cc_find_skills` | 分页检索当前有效经验 |
| `cc_list_tasks` | 分页读取任务摘要 |
| `cc_get_task` | 完整任务详情分页，每页最多4步骤、完整结果最多6000 UTF-8 bytes |
| `cc_copy_task` | 按源 revision 复制，字面替换、重置执行字段，生成待确认草稿 |
| `cc_prepare_task` | 从当前用户来源创建内部任务草稿 |
| `cc_capture_feedback` | 记录反馈及来源，不授予研发权限 |
| `cc_read_memory` | 分页读取有效已确认事实 |
| `cc_draft_checklist` | 将当前有效 L0 经验装配为清单草稿 |

写工具的逻辑身份按可信 scope、原始消息、动作和意图槽持久化。换适配器、重启或重新派工不改变操作身份；同槽变更 payload 会冲突，新用户请求拥有新身份。工具使用服务端当前事实，不接受模型自报权限。

## 页面及领域

工作台、运营助手、任务清单、工作日历、学习笔记、改进反馈、经验与记忆、活动日历、数据报表、库存补货、发货协同、广告分析、使用说明共13个入口；登录和设置使用独立受控入口。

任务/用时/排期、活动四阶段、CSV批次、预测与按日库存、实物池分配与人工发货、广告指标均保留确定性领域规则。笔记不自动成为记忆；成功流程经确认与风险校验派生经验；Provider 在实际使用时重查 hash、scope 和来源。页面表单在模型离线时可用。外部 Amazon、ERP、改价、广告修改与消息发送不在已交付能力内。

## 重构与恢复边界

原来的统一业务分派拆为应用命令处理器；查询不再驱动学习写入。Task 类型归任务领域，学习通过持久业务事件消费；不使用定时全量 Provider 失效。旧自建对话执行路径没有迁入新项目。

隐私账本作用于派生实体、Skill、Session、Ticket 和已消费上下文。删除或撤销使旧 master epoch 失效，原生 checkpoint 后换新上下文；维护期间已提交业务结果仍可查询。模型 reserve/settle 覆盖路由、worker 和压缩，未知用量保守保留；自动模型重试为零，累计调用/金额不设自定义限额。

备份协调 business、预算、原生 Store、Session、文件与导出。恢复只发布经哈希、业务完整性和原生 owner 校验的新目录，合并最新隐私及用量。旧格式会话不伪装为原生会话：无隐私删除时原行保留在业务 SQLite 供离线审阅，有删除事件时按隐私闭包退役。当前没有旧会话归档页面，也没有迁移旧生产数据。具体操作见[本机恢复](../operations/LOCAL-RECOVERY.md)。
