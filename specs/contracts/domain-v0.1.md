# 业务与编排契约 v0.1

状态：前置设计；运行验证 not_run。

## 身份与实体

所有业务实体包含 id、kind、scope、revision、createdAt、updatedAt。时间存 UTC，列表按北京时间，站点排期/工作日历保留各自已交付时区语义。数量、币种、日期、报表 asOf 与来源均为结构化值，不由模型摘要改写。

可信 scope 来自服务端认证会话，绑定 Source→Ticket→Assignment→Agent 工具上下文。客户端 header、消息文本、工具参数或显示名均不能独立指定任意 scope。主入口默认 main；负向用例另建合成 scope。跨范围 ID 返回 NOT_FOUND 或同等不泄露存在性的错误。

## 任务与工单

BusinessTask 保留旧草稿、确认、勾选、状态、清单、用时和排期语义，领域服务单一拥有不变量。创建/更新/复制/活动生成任务经过同一服务；同一业务库内需要多实体一致时在一个短事务中提交。

Ticket/Mandate/Assignment 使用上游真实对象。业务请求 ID、来源事件、业务实体 revision 与 Ticket 关联，但不得复用其中任意一个 ID 假充另外一个实体。Ticket ready 表示助手结果就绪，用户确认及业务完成必须走各自命令。

## Command、Query 与事件

- Query 是纯只读，不 drain、tick、写状态、调模型或创建工单。
- Command 校验身份、范围、参数、revision 和来源，在业务事务中写实体、幂等回执及 outbox。
- 相同 command requestId 与同一 payload 重放返回原结果；不同 payload 复用同一键拒绝。并发 revision 不符拒绝，不静默覆盖。
- Source 仅读取已提交 outbox，稳定 Trigger ID 包含事件 ID/修订及 schemaVersion，游标和投递回执持久化。至少一次投递通过上游去重和业务命令幂等实现一次业务效果。
- 事务提交后、投递前崩溃可重放；投递后、记录游标前崩溃不得重复建 Ticket 或业务记录。不能假称跨业务库/编排库事务。
- 学习消费成功事件，不被 Task 领域同步反向调用。活动一次生成的阶段任务和复制来源在业务事务中保持失败原子性。

### Source 确定性准入

| 事件类别 | 是否进入 Engine.receive / Eval | 处理 |
| --- | --- | --- |
| 认证对话入口提交的 human_request | 可进入，仍受 Policy/Mandate 约束 | 稳定消息事件 ID；人类补充按上游订阅路由，不重造授权 |
| 普通表单 Command、任务完成、学习派生、活动 tick、反馈存档 | 不进入新工单准入 | 仅业务消费者处理；即使 actor 是人，也不是对话工作请求 |
| 助手 Channel 回执、工具结果、模型输出 | 不重新接入 Source.receive | 关联原 Ticket/业务回执展示，禁止输出回流自触发 |
| 已关联 Ticket 的必要业务上下文更新 | 不得产生新 Eval、Ticket 或模型调用 | 默认下次执行时查询；若使用推送，只能走受控的非唤醒上下文接口，并先验证该接缝 |

Source 在调用上游 receive 前过滤非 human_request，不能仅依赖模型判断“无需处理”。业务 outbox→Source 连线表示选择性适配，不是全部事件转 Trigger。原生执行器内部的已授权后台工作完成仍按其既有机制继续，不将该完成事件伪装成新用户请求。

### 稳定业务操作身份

模型写工具不负责生成可信 requestId。适配层在首次执行前将 logical operation 绑定为 `{scope, originatingMessageEventId, operationKind, intentSlot}`，分配 operationId，持久化规范化 payloadHash、原生事件/逻辑步骤引用、pending/committed 状态及结果引用。业务 Command 使用 operationId 作为幂等键，实体写入、结果回执和 outbox 在同一业务事务提交。

唯一逻辑键跨 Assignment 更换、进程重启、原生事件重放和同一来源的模型重新规划保持不变；不得使用新 Assignment ID、临时 toolCallId 或随机运行内 ID 生成新业务键。已绑定的同一 intentSlot 如 payload 改变必须冲突，不能借修改 payloadHash 产生第二个操作。首次并发预留通过唯一约束获得同一 operationId；pending 但无业务提交可继续，committed 返回原回执。

不同的真实人类消息事件即使 payload 相同也有不同操作身份，应分别执行。同一来源确实要求多份相同结果时，先形成可证明属于该请求的多个逻辑意图及独立 intentSlot，再执行；缺少可恢复的意图区分则澄清，不以重复模型调用猜测新意图。intentSlot 是可信适配层持久化的逻辑步骤身份，不接受模型任意改值扩大次数。该映射作为 SP-06 接缝的必验部分，不能宣称已有现成 API。

## 来源修订、撤回和删除

消息补充产生新版本/事件，不覆盖旧确认事实。反馈/经验来源是数据，不授予开发或外部写权限。收到撤回/删除后：持久化隐私意图→阻止新的工具执行/派生→停相应后台工单或标不可继续→失效摘要/Skill/缓存与引用。迟到投递重新检查 tombstone，不重建原文。

原生历史不能任意改写。被撤销来源涉及的 Session/Ticket 不再允许恢复其旧上下文继续业务执行；保留最小不含正文的 lineage denylist，创建新的合规上下文。恢复先重放该账本后才注册 Source、开放 Query 或执行器。

## 断线、取消和恢复

浏览器 disconnect 不触发工作取消。显式 cancel 绑定可信 scope+ticketId，记录意图后调用原生停止；同一操作幂等。提交命令前和异步等待恢复后检查工单与来源仍有效；取消后不允许迟到回调产生新写入。已提交结果保留并明确展示。

程序重启使用上游 Assignment 恢复语义及持久业务回执；先检查原生事件、业务结果和 outbox，不重复外部效果。模型失败零自动重试；用户明确继续可成为新的可审计请求。内部投递重放不等于自动追加付费模型尝试。

## 错误及结果

对外使用可解释中文错误与 requestId，不返回栈、凭据、任意路径或原始模型异常。结构结果区分 draft/ready/completed/cancelled/blocked/failed，不以文字“完成”代替持久实体状态。空集合、未知日期/用量/指标用明确状态或 null，不伪造为零。
