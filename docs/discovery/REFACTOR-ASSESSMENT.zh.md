# 旧代码重构分析

2026-11-02｜静态源码检查，未运行产品测试。不将职责复杂等同于已经发生运行故障，也不按行数机械判定质量。

| 发现及旧路径 | 具体问题 | 新结构与保留条件 |
| --- | --- | --- |
| apps/server/business.ts:39–42；app.ts 的 GET /api/snapshot；App.tsx:62 | 查询快照先 drain 两个队列并 tick 活动，页面轮询可触发写入 | Query 纯只读；消费者显式运行。Source 检查绝不能调用带写副作用快照 |
| apps/server/business.ts（358 行） | 装配、全量快照、页面 action 分派、校验、状态和工具投影混合 | 有类型的领域 command/query handler 与应用服务；页面和工具共用服务，无新增万能 action 链 |
| packages/learning/service.ts:33；operations/tasks.ts；activities.ts:49；task-copy.ts | Task 类型归学习，任务反向依赖 Learning，多处直接建任务 | Task 领域拥有类型/不变量/创建/复制；学习消费成功事件；活动批量任务和复制仍保持单业务库事务 |
| apps/web/api.ts；App.tsx | 客户端直接依赖服务实现类型，刷新拉所有领域 Snapshot | shared contract/DTO/schema；按领域分页和订阅；未测容量，不声称已有性能故障 |
| apps/server/chat.ts:148 | 浏览器断线导致关闭 scope 进程；业务库另存 conversation/nativeId | 原生 DSH 会话为对话权威，业务任务/Ticket/Assignment 分离；断线继续，显式取消单独定义 |
| packages/cc-harness-adapter/plugin.mjs:108 | Provider 每秒整体失效 | 事件驱动失效；每次读取和执行仍检查来源、状态、hash、scope；不能为优化取消撤销保障 |
| scripts/verify.py | 需求正则只识别单段大写标识，漏 CC-TASK-COPY-001 | 多段 ID 正则及机器验收矩阵覆盖检查 |

优先复用已有清晰的纯规则和行为断言：时区、复制、广告微单位金额、CSV 规范化、共享分配、CAS/幂等、来源和隐私恢复。逐模块迁入，校验 import 方向，不把旧 server/chat、SDK 进程封装和全量页面调度器原样包一层继续使用。

建议逻辑边界为 workbench-client、workbench-source、operations、analysis、learning、agent-tools，以及共享 contracts/storage-policy；它们是架构职责，不要求现在建空包。物理包粒度在 P0 兼容性实验后冻结；同一业务数据库仍只有一个持久化写入服务。
