# 模型工具与经验契约 v0.1

保留现有 9 个工具名。所有工具由原生 agent-local registry 注册并经过同一应用服务。权限来自当前认证工单及 scope，而不是参数。运营 preset 禁用通用开发工具；工具单调 guard 在真正执行前检查工单、来源、范围、版本及 Skill。

| 工具 | 输入及输出边界 | 效果 |
| --- | --- | --- |
| cc_read_operations | query；返回范围内活动/库存/发货/广告摘要及来源日期、截断信息 | 只读 |
| cc_find_skills | query、offset；搜索全部有效经验，现有语义每页 6 条和 nextOffset | 只读 |
| cc_list_tasks | offset；每页 8 条摘要及 nextOffset | 只读 |
| cc_get_task | taskId、offset；每页 4 完整步骤，带 revision 和 nextOffset，模型结果 ≤6000 UTF-8 bytes | 只读 |
| cc_copy_task | taskId、revision、可选 title、完整替换对；字面区分大小写，返回精简确认 | 事务创建新草稿；重置执行/用时/排期；保留 source lineage 和幂等 |
| cc_prepare_task | title、timeZone、checklist、可选 dueAt | 创建待 cc 确认的内部草稿；无外部操作 |
| cc_capture_feedback | text、可选 expected/actual；必须关联当前真实消息来源 | 捕获候选，不产生开发授权 |
| cc_read_memory | offset；每页 4 条有效确认事实，保留来源引用 | 只读 |
| cc_draft_checklist | skillId；当前有效 L0 版本的未勾选清单与版本 | 返回草稿结构，不独立持久化任务 |

参数字段、裁剪和输入边界在 P0 原生契约探针中冻结完整 schema；不得因内部 DTO 重构改变上述可观察行为。查询字节上限、最大中文清单、非法时区和超长遗留字段必须覆盖。

cc_copy_task、cc_prepare_task、cc_capture_feedback 的 operationId 从可信调用上下文注入业务 Command，不新增一个由模型自由填写的权限/幂等参数。跨 Assignment 与重启的原始消息事件和逻辑意图映射遵循[领域契约](domain-v0.1.md)；恢复后同一意图只产生一次效果，两次真正的新用户请求仍可分别执行。

cc-approved Provider 仅发布当前 scope 有效、来源未删、hash 正确的经验。原目录最多投影 6 条，搜索工具仍能检索全部有效经验。版本变化主动失效缓存；读取与使用再次检查，不能依赖每秒刷新或旧会话正文。

L0 为内部清单草稿，经来源确认与规则回放后启用；L1 需确认该版本；L2 外部副作用拒绝。成功依据是 cc 明确确认及已完成清单，不以模型自评作为成功证据。关闭学习停止新派生但不破坏基础任务与笔记。

页面拥有的库存/广告等写命令不自动变成模型工具。任何扩大工具能力均须记录独立产品变更，不隐含在重构中。
