# P1 平台与迁移接口 0.3.0

启动后的首批冻结接口；产品代码基准711c630，实际派发记录保存完整SHA。Leader拥有host/index.ts及共享DTO；writer按任务排除并行路径。

## 平台

设置新增可选publicOrigin（无路径/凭据/查询的canonical HTTPS origin）和migrationMode boolean。缺省保持本机loopback行为；公网模式必须仍只绑定loopback，由明确配置Origin用于HTTP boundary和nativeAccess。不能从任意转发头推导授权Origin。登录cookie在公网模式Secure，保持HttpOnly/SameSite=Strict。

平台writer可修改scripts/start.mjs、scripts/build.mjs、profiles、deploy、boundary/native-access及独立平台helper；host/index.ts由Leader按其导出helper集成。提供origin/settings验证、cookie policy和最小健康响应helper，说明精确接线。不通过全局关闭原生权限或链接检查实现部署。迁移模式禁用业务tick、Source接单、业务写入与模型调用，只开放认证读取/健康及必要受控备份，不修改现有数据。

build/release manifest记录全部实际运行产物、固定锁文件、patch、profile和许可证；不得含secret或私有路径。完整Linux验证由隔离真实宿主及CI执行，Windows继续回归。systemd模板仅示例身份/路径，运行数据与代码分离，配置受限，产品不继承GitHub/SSH凭据。

## 迁移

在新独立migration模块提供export/validate/compare/stage能力，具体函数在交付说明中精确列出。旧源没有business_events，必须按完整数据库实体、墓碑、隐私、队列/回执/确认历史与文件集合对账。读取源不得写其WAL/SHM；活动WAL通过SQLite一致性backup或私有副本策略处理，禁止immutable忽略WAL。原生新库恢复仍复用已有校验和单写owner，不把旧会话当新DSH。

输入数据源目录与输出快照/候选互不重叠、无链接逃逸。快照manifest校验全部文件及完整实体集合，清单本身包含schema与版本。重复/中断操作只能发布验证后的新目录，目标已有数据拒绝覆盖。最终阶段要求显式sourceQuiesced证明或操作员已核实的冻结栅栏，工具不得自行声称当前在线源已停写。

私有维护登记作为独立受限输入/输出保留原结构及ID/revision/判定，不复制到公开仓库或产品可下载路径。先完整保留，再追加migration映射；不能把全部历史标成accepted或重采集。旧用量保留独立命名空间历史/新账本合并须不碰撞、不退款、缺usage保守留账。manifest与对账输出在私有存储，公开只保留中性摘要及工件hash。

只用合成fixtures开发测试；不读取生产原始建议进行开发。先做真实Red/Green并报告迁移不变行为回归。真实快照/最终对账与生产操作由Leader执行。
