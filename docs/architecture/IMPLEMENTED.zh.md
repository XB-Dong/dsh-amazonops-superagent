# 已实现架构（P0 + P1）

P0基线为2026-11-02，P1增量与云端接替为2026-11-05。分别见[P0历史验收](../testing/EXECUTION-20261102.md)、[P1执行报告](../testing/P1-EXECUTION-20261105.zh.md)及[P1状态](../waves/P1/state.json)。

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

认证后的 `human_request` 使用显式路由；P1只增加两类可信事件：当前有效有限授权下的 `watch_update`，以及唯一规则、明确对象/当前版本下的 `risk_candidate`。普通业务事件、后台tick、反馈捕获和回执不进入模型Eval。master仅有route、reply、eval、eval_decide；worker原生及业务工具按Ticket授权，shell、文件、安装和管理能力不在运营会话授权内。

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
| `cc_read_watch`（P1） | 读取当前授权对象和确定性风险，写草稿前必须重查最新事实 |

写工具的逻辑身份按可信 scope、原始消息、动作和意图槽持久化。换适配器、重启或重新派工不改变操作身份；同槽变更 payload 会冲突，新用户请求拥有新身份。工具使用服务端当前事实，不接受模型自报权限。

## 页面及领域

工作台、运营助手、任务清单、工作日历、学习笔记、改进反馈、经验与记忆、活动日历、数据报表、库存补货、发货协同、广告分析、使用说明共13个入口；登录和设置使用独立受控入口。

任务/用时/排期、活动四阶段、CSV批次、预测与按日库存、实物池分配与人工发货、广告指标均保留确定性领域规则。笔记不自动成为记忆；成功流程经确认与风险校验派生经验；Provider 在实际使用时重查 hash、scope 和来源。页面表单在模型离线时可用。外部 Amazon、ERP、改价、广告修改与消息发送不在已交付能力内。

## 重构与恢复边界

原来的统一业务分派拆为应用命令处理器；查询不再驱动学习写入。Task 类型归任务领域，学习通过持久业务事件消费；不使用定时全量 Provider 失效。旧自建对话执行路径没有迁入新项目。

隐私账本作用于派生实体、Skill、Session、Ticket 和已消费上下文。删除或撤销使旧 master epoch 失效，原生 checkpoint 后换新上下文；维护期间已提交业务结果仍可查询。模型 reserve/settle 覆盖路由、worker 和压缩，未知用量保守保留；自动模型重试为零，累计调用/金额不设自定义限额。

备份协调business、预算、原生Store、Session、文件与导出。恢复只发布经哈希、业务完整性和原生owner校验的新目录，合并最新隐私及用量。P1已完整迁移旧生产业务、隐私和预算，并将旧SDK会话保留私有离线归档；没有旧会话归档页面。具体见[本机恢复](../operations/LOCAL-RECOVERY.md)和[上线与维护](../operations/PRODUCTION.zh.md)。

## P1 责任与跟进

领域Followups只管理有限授权、确定性风险、版本事件/游标和接单窗口；原生Runtime/Engine仍拥有Ticket/Mandate/Assignment/attention及Session。FollowupNative串行投递，在配置修改前和扫描前从真实持久Decision回写结果；markDelivered只代表入站，不冒充accept。策略新revision可以重新观察，真正accepted auto窗口跨开关不重复派工。

可信auto闭包由宿主配置提供，默认关闭，在启动/恢复/入站和每次工具授权复查；HTTP声明不能开闸。保存的auto意图遇关闭闸门时有效模式为off，旧worker也不能继续写。当前事实、scope、来源、期限及人工等待共同约束执行。GET投影不扫描或消费工作。

工单补充/答复使用稳定意图和CAS，丢响应重放不重复派工。后续人工答复保留原watch/事件父链，删除原授权会闭包删除派生草稿并退役旧会话。客户端只投影原生责任，工单草稿按ticket/attention保留，不新增第二套工单状态机。

Windows运行根按真实物理路径及目录身份固定，允许同一目录的8.3/长路径拼写；原路径和标准路径每级检查junction及符号链接，目录创建前后复核，模型及工具继续检查。物理比较不采用缺目录时退回字符串的兜底，也不允许同名根目录替换继承旧授权。
