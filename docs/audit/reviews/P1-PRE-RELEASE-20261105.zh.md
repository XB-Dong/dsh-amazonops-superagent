# P1 发布前独立审核汇总

2026-11-05。本文由 Leader 汇总实际独立审核返回结果；原始独立报告、命令及证据留在维护者私有存储，哈希见[执行索引](../../waves/P1/execution-evidence.json)，不以作者自检代替审核。

独立审核接受精确候选 `16b2ae1a1a967e3155e99a8d9b2c4b6f8525892c` 的35项 pre_release；G2/G3/G4须各自实际运行，未在本结论提前通过。

已独立复核最终制品及25份原始工件哈希、精确提交双平台CI、实际HTTPS/RPC/WSS 80项检查、最小权限systemd 8阶段及异常后真正Runtime恢复。此前锁/退出码Red、夹具失误和修复日志保留。RestartSec35保留上游30秒owner保护，不删活锁；PID恢复与Runtime ready分别核验。

维护初始化遗漏的新增、同修订补充及撤回反例修复后持续可见；完整registry metadata和未处理差异不被初始化吸收。自动闸门覆盖持久auto重启与恢复worker的每次执行。发布仅manifest工件可真实加载原生扩展，未借源码目录补缺资源。

原生CI第五次请求按真实durable inbox、消费记录与provider载荷确认是合法结束通知续步；三个反证仍拒绝无新输入、无入队或伪造空轮次，worker两次调用及单草稿/单投递约束保留。未改官方循环以迎合计数。

工单重试补证使用合成真实Engine+SQLite Store，经实际WorkbenchSource.action建立新Assignment，回执重放不重复retry，旧版本/跨scope/非可重试状态拒绝。Executor是记录端口，不冒充浏览器或收费模型的失败工单重试。

必要真实模型watch链、冷启动observe、浏览器、Linux/Windows及生产门槛分别绑定各自候选和范围。旧master的语义误忽略、两笔未知用量、首屏一次刷新和反馈未提交切页清空均不被隐去，也不冒充已修复。
