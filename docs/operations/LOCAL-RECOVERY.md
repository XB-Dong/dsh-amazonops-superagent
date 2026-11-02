# 本机恢复与旧格式迁移

这是研发终端工具，不是模型工具。仅操作明确指定、已授权的本机数据副本。P0 验证使用新建合成数据；不读取旧线上服务、连接云端或迁移生产。

先退出新工作台并确认其进程停止。备份应通过应用的协调 checkpoint 生成，包含 business.sqlite、model-budget.sqlite、privacy-ledger.jsonl、必要的 harness/superagent/files/exports 和 manifest.json；不能在运行中随手复制 SQLite 主文件。

在项目根目录运行：

```powershell
node scripts/recovery.ts --backup '<备份目录>' --destination '<新home目录>/data' --current '<当前home目录>/data'
```

三个参数都是数据目录：backup 是带 manifest.json 的恢复点；destination 是全新或空目录，不能与两个输入重叠或互为父子；current 提供最新 privacy-ledger.jsonl 和 model-budget.sqlite。参数可加引号，必须完整提供且不能重复。工具拒绝覆盖、路径穿越、备份内部符号链接或损坏哈希。

工具在目标同级临时目录恢复，沿用业务恢复 API 合并最新模型请求与不可变归因、重放删除/撤销，再以目录重命名发布完整结果。失败清理自己的暂存目录，不发布半份数据；输入目录始终只读。不能用较早账本取代 current 来恢复已删除资料或退还模型用量。

成功只输出 JSON 元数据：文件/实体/请求数量和实体摘要 hash；不会输出密码、业务原文或本机路径。失败输出安全错误码并返回非零退出码，原始异常及参数不打印。新目录经进一步核对后，才能作为新应用的 home/data；脚本不会自动改配置、启动服务或切换原有应用。

旧 ccagent 兼容格式的 business.sqlite 可通过同一流程复制到新数据目录，原 id、scope、revision、来源和字段保持；新 Store 添加自己的必要表。最新隐私账本要求删除或撤销的数据会按规则失效，因此不能仅以迁移前后总条数相等判断正确。P0 合成测试核对保留任务的精确字段、来源引用、查询输出、文件 hash、旧表升级、较晚模型用量/归因和删除不复活。

恢复启动时，Ticket的执行目录按当前实例重新派生。新建worker的Session header指向新home；既有Session的不可变header仍记录历史路径，有效目录通过DSH官方working-directory/change事件迁入当前home。每步模型和工具调用继续检查有效目录，不能退回原输入目录执行。真实进程测试比较恢复、启动、派工执行和关闭前后的源目录全树路径及文件hash，源目录不变。

合成旧格式测试覆盖任务、报告、预测、库存、实物池、分配、发货、广告、活动、笔记、反馈、记忆及经验的字段和业务输出。旧CC conversation在没有隐私删除时原样保留在业务SQLite，供离线审阅；不会转成新原生Session或加载到工作台对话。当前隐私账本含删除时，历史conversation/summary按闭包退役。正式旧资料迁移未在本轮执行。

这不证明任意未来格式、旧原生 Session 或生产迁移均已支持。原生日志只能由其受支持 provider 处理，不能改写成伪造的新对话。正式数据迁移与云部署仍需独立明确范围。
