# P0 本机执行与验收记录

2026-11-02。最终统一验证及独立复核正在收尾；完成状态以[执行状态](../waves/P0/state.json)为准。[59项矩阵](acceptance.json)记录逐项结果，[脱敏工件索引](execution-20261102.json)记录命令、基准与原始工件哈希。原始数据库、日志、截图、用户配置及凭据全部保存在仓库之外。

代码及夹具冻结 `d7a8d9ab9f9114ff8f466b824a22fceaf531c07b`：严格类型检查及构建成功，完整离线测试237通过、0失败、0跳过；59项矩阵均有分层证据。该次本机运行仅有文档待提交，索引逐项记录了实际脏状态，未把它写成干净构建；发布提交另由干净CI验证。

## 范围和证据口径

复现旧系统已交付的20组需求，使用真实 SuperAgent Runtime/Engine/Store/Effects 与 DSH 原生会话。本机 Windows 实现，未连接旧云服务器、部署、迁移生产数据或修改旧自动任务；GitHub同步及必要模型HTTPS调用属于本轮单独授权范围。原项目 HEAD 及原有3项未提交文档状态与开始时相同。

域层测试验证确定性规则与事务；带 `unit` 的集成测试使用受控端口模拟故障。原生集成测试实际启动官方 DSH、调用本地 Anthropic SSE fixture，并读取官方 Session owner 和真实 Store；网络围栏拒绝外部地址。真实模型验收另行调用官方服务。浏览器验收通过实际登录、表单操作和文件下载进行，不以源码、DOM节点存在或按钮可见替代操作成功。

没有把所有故障组合都伪称为端到端复现：游标丢回执与换 Assignment 身份由受控故障端口验证，真实原生回归另验证重复提交、取消、重启、checkpoint、恢复和隐私闭包。权限组合由角色规则、实际恶意工具探针、恢复生命周期与每步 guard 共同覆盖；没有声称每个 HMR/派工组合均另做一次攻击。

## 真实模型与用量

最新严格验收为两个场景：创建两步骤任务草稿；查找并完整读取原任务，按字面替换后复制。原任务及来源保留，新任务等待确认。每个场景同时要求：真实业务工具成功回调、Ticket ready、`orchestrator_reply` 的 `purpose=result` 成功回调、对应 outbox 已发送、同 ID/正文消息出现在工作区、master 和 worker 原生轮次均正常结束。收到 acknowledgement 或仅有草稿均不算通过。

最终模型代码冻结 `9558c4a` 的最新运行20次请求全部结算并验证 usage：输入82777、输出4589。此前诊断运行也保留，累计五次运行91次请求，其中88次有验证用量，3次未知；已验证输入331006、输出14113，未知请求保守预留输入65402、输出6144。预留不是实际消耗，不按零处理，也不换算未经核实的费用。没有重置旧账本或设置自行估算的累计金额/请求预算；保留90秒请求超时、每轮循环保护和零自动模型重试。此后若有网络断线保护等与模型路径无关的改动，单独关联其离线/接入验证，不冒称在较后提交上重做收费调用。

## 按需求组核对

以下工件简称在脱敏索引中有哈希；同组仍按矩阵的每个 case 单独关联，不能用一个总测试数代替59项验收。

<a id="a01"></a>
### A01 · 中文入口

A01-01、A01-02：实际离线工作台显示中文问候、例句、13个入口和助手不可用状态；表单可继续操作。补验前后账本均为0次模型调用。使用说明仅列已实现能力及 CSV 格式。错误显示安全提示，认证测试另验证不回显内部异常。证据：`browser-offline`、`ui-status`、`boundary`。

<a id="a02"></a>
### A02 · 原生会话

A02-01至03：实际 Source/worker/原生流式工具与最终投递；手动及按8192上下文生产配置自动压缩；正常结束及重启恢复。取消会中止当前本地流，断开页面不等同取消。失败、截断与未知 usage 的结算分支由 accounting 回归验证，实际取消另有原生流证据。证据：`native-e2e`、`compaction`、`accounting`、`live-final`。

<a id="a03"></a>
### A03 · 任务

A03-01至03：任务确认、编辑、勾选、锁结构、来源和 CAS；分钟0至1440或空；IANA/DST排期拒绝不合法输入。北京时间创建日期、未知日期末尾由纯投影回归验证；浏览器实际选择空日期并显示0项。输入37分钟后切状态、切日期均保留，未自动覆盖已保存的25分钟；取消再打开取回25。证据：`tasks`、`task-edit`、`task-list-view`、`tasks-draft`、`browser-task`。

<a id="a04"></a>
### A04 · 完整复制

A04-01至04：真实原生 worker 按0/4/8读取九步骤，原生回调返回4/4/1项、下一页4/8/null，完整 JSON 均不超过6000 UTF-8 bytes；随后复制九项、源任务不变。域层覆盖30个长中文步骤、大小写和正则标点的字面替换、revision冲突、重复/变更payload、失败无孤儿和删除闭包。页面预览五项后确认生成草稿；未配对替换禁提交。非法旧时区由任务复制域回归拒绝。证据：`native-paged-copy`、`task-copy`、`task-list-view`、`browser-task`。

<a id="a05"></a>
### A05 · 工作日历

A05-01、02：新增完成日期投影回归，覆盖 UTC 跨午夜、纽约 DST 重复/跳时、未知日期单列、非完成排除、null/undefined与0不同、计划时长不充当实际。浏览器实际更正25→37、清空后显示1项未记录、填写0后显示0项未记录。证据：`work-calendar`、`browser-calendar`。

<a id="a06"></a>
### A06 · 笔记

A06-01、02：浏览器新增、编辑、搜索、暂停学习后继续编辑、实际新进程重启读取、删除；scope/CAS/幂等、独立笔记来源、不自动成为经验及恢复后删除闭包由 notes/note-privacy 验证。证据：`notes`、`note-privacy`、`browser-notes`。

<a id="a07"></a>
### A07 · 活动

A07-01至03：四阶段与 IANA/DST、提前时长、到期补发一次、取消后不新增、创建失败原子性。页面实际创建意大利活动及四阶段内部任务；日期和实际生效仍需人工核对，未调用真实平台改价或外部消息。证据：`activity`、`browser-activity`。

<a id="a08"></a>
### A08 · CSV 报表

A08-01至03：字段映射、引号、缺失/重复/非法日期和数字、指纹幂等、身份规范与来源。预览显示总数7行，表格展开前6行，编码000123保持字符串；确认及CSV导出均含全部7行，重导出与已确认CSV逐字相同。页面只接受 CSV，不声称通用 Excel 可用。证据：`reports`、`csv`、`browser-sales`。

<a id="a09"></a>
### A09 · 预测与库存

A09-01至03：连续7日均值或带原因人工估计、版本/原基线、不足拒绝、逐日到货/倍率/预留/损失/补货日期和分数需求。页面从批次获得日需求6，库存12推演缺货及建议102件，保留预测与假设；过期在途日期和负数量实际拒绝，不新增方案。证据：`inventory`、`browser-inventory`。

<a id="a10"></a>
### A10 · 发货协同

A10-01至03：补充双Store竞争 CAS、SKU/kind/店铺/日期窗、可信字段复用、四前置、归一化双号跨单唯一、发运前/倒退/超量/小数入库、stale取消回滚和只释放一次。页面合成批次150分配100，人工假单号发运后累计到货40；没有真实 Amazon/ERP 请求。证据：`shipping`、`browser-shipping`。

<a id="a11"></a>
### A11 · 广告

A11-01至03：币种/campaign分组、零分母null、微单位、预算/完整同币种成本及报表asOf归因规则。实际导入并显示花费15、收入60、ACOS25%、ROAS4；缺成本利润未知。下载指标CSV含相同计数、比率和未知利润；不执行广告修改。证据：`advertising`、`browser-ads`。

<a id="a12"></a>
### A12 · 反馈

A12-01至03：来源去重、有限中文规则、精确归并计次、补充/修订/撤回及迟到重放闭包。页面实际补充、确认变更、下载审阅包再撤回；合成资料与新home，没有加载私人生产去重登记。候选反馈不触发研发或模型自循环。证据：`learning`、`privacy-closure`、`browser-feedback`、`source`。

<a id="a13"></a>
### A13 · 记忆

A13-01至03：事实确认/推断/纠正、scope、引用/否定、不猜测缺失；摘要由当前事实重建并受CAS/来源约束。真实 Session Provider 及原生 master epoch 测试证明当前事实装配、旧排队历史过滤和删除后新上下文不含旧文本/ID；恢复旧备份不复活。证据：`learning`、`privacy-closure`、`native-skills`、`master-privacy`、`native-e2e`。

<a id="a14"></a>
### A14 · 经验

A14-01至03：确认成功流程、L0校验启用/L1待确认/L2拒绝、暂停后补消费；全量分页搜索与Provider当前目录、hash/scope/source、实际原生加载回调。失效经验使已消费会话和在途工具拒绝；页面实际停用经验。清单复用及模型任务仍是草稿。证据：`learning`、`refactor-closure`、`agent-tools`、`native-skills`、`browser-skill`。

<a id="a15"></a>
### A15 · 需求历史与审阅包

A15-01、02：稳定变更/撤回ID、日期、替代链和重导出稳定。新补充先进入pending附录，旧确认的ID/text/amendments/revision不变；重新确认才产生新版本并保留旧历史。运行进程环境移除 GitHub/Git 凭据，产品不修改源码或自动推送。证据：`privacy-closure`、`packaging`、`browser-feedback`。

<a id="a16"></a>
### A16 · 运营摘要

A16-01、02：只读摘要携带来源/日期/scope、字节上限与遗漏元数据，涵盖活动、库存、发货、广告。领域写表单不扩大模型工具授权；真实 worker 只取得当前授权工具。证据：`context-bounds`、`operations-policy`、`native-startup`、`agent-tools`。

<a id="a17"></a>
### A17 · 编排与幂等

A17-01至05：原生完整链的真实对象与回调、持久决策/派工/outbox、重复与重启唯一效果；取消和断线语义分离。受控故障验证“业务回执已落盘但来源游标未提交”与适配器/Assignment重建；可信意图槽解决同源重复，同payload新用户消息分别生效，变payload冲突。仅认证human Source准入，派生事件不会新建 Eval。上游15个core哈希不变，operations无需GitHub或shell。证据：`native-e2e`、`source`、`operation-identity`、`operations`、`operations-policy`、`core-provenance`。

<a id="a18"></a>
### A18 · 安全与记账

A18-01至04：HTTP监听器拦截、Connection准入和RemoteAccess策略分别验证匿名、Origin/Host、cookie、可信scope及退出后的拒绝；原生Session读取另由浏览器实际验证。RPC动作及资源白名单、文件/管理路径拒绝由各对应边界测试验证，未逐原生入口整机重放全部负例，也不声称另做了时间推进的过期整机测试。原生角色工具和agent-local每步guard限制运营能力。所有LLM入口reserve/settle并保留角色/会话/轮次/用途归因，未知不当零、失败不自动重试；单写服务CAS/幂等和统一跨scope错误。证据：`boundary`、`native-access`、`security-acceptance`、`agent-tools`、`accounting`、`budget`、`native-startup`。

交付实例另做实际接入验证：匿名原生HTTP路径401、文件/管理路径403、Gateway的settings/describe和session/create返回remote-access/denied；WS匿名401、错误Origin403、合法101，退出使现有连接以1001关闭，旧cookie再连接401。新增真实子进程回归复现拒绝升级后RST导致ECONNRESET退出，再验证16次局部socket拒绝及官方DSH的12次拒绝RST、正常注销和骤断后宿主存活。修复限于单socket错误处理，保留原生owner及全局异常语义。证据：`native-socket`、`handoff-network`。

<a id="a19"></a>
### A19 · 迁移与协调恢复

A19-01至03：合成旧格式覆盖完整业务实体、来源/ID/revision及查询输出，库存/广告重算一致、文件hash一致、旧表升级、输入全树不变。旧CC会话无隐私事件时保留SQLite原行供离线审阅；有隐私事件则闭包退役，不伪装原生会话、不加载到页面。

真实原生 checkpoint、官方 Session owner、完整备份和 CLI 新目录恢复另有进程回归；较晚预算/归因合并而不退款，最新删除/撤销先重放。排队工单没有Session须有持久launch；确实执行过的历史缺Session仍拒绝。恢复的有效执行目录必须属于新home，旧immutable header保持历史；源目录在恢复、启动、执行及关闭后全树字节不变。预算输入通过目标内db+WAL副本读，避免readOnly仍写源sidecar。证据：`recovery-cli`、`recovery-readonly`、`recovery-owner`、`native-e2e`、`native-queued`。

<a id="a20"></a>
### A20 · Windows 与交付

A20-01至03：实际Windows Node24、官方DSH子进程、Windows绝对路径和junction负例；独立home/state/data/loopback端口/账号。launcher在写入或spawn前拒绝链接祖先及状态树；恢复拒绝重叠目录、恶意manifest和输入链接。旧仓库只读，原有3项文档改动保留；本轮没有SSH/云端命令、部署或旧自动任务变更。证据：`launcher`、`packaging`、`recovery-cli`、`isolation-audit`。

首轮干净Windows CI因真实8.3 TEMP别名与长路径被词法guard误判而失败，日志保留。修复固定物理root及dev/ino身份，原路径与标准路径逐祖先拒绝链接，创建目录前后和每步调用都检查。真实短路径下启动master、排队worker和恢复既有worker通过；共同指向外部的junction、同名普通root替换、旧目录回落与缺失目录仍拒绝。CI在全套之前增加实际原生启动门槛。证据：`windows-physical`、`ci-diagnostic`；不以放宽授权或延长超时代替修复。

## 修复与复核记录

保留的真实产品 Red/Green 包括来源策略未初始化、Skill注入scope、读取来源/经验lineage、master隐私epoch、原生RPC授权边界、用量归因恢复、重复prompt清理、工具可选字段JSON传输、成功报告后的TICKET_ENDED、默认压缩阈值不触发、只读页面默认workspace写入、CSS未挂载、分钟草稿筛选丢失、恢复旧工作目录、SQLite输入sidecar写入及拒绝升级后socket RST导致宿主退出。假模型接线或预期写错只记fixture修正，不充当产品Red。后补shipping/工作日历/旧格式覆盖是已有行为回归，不声称先失败。

前端、后端、原生、集成与只读独立复核使用分离写入worktree与明确路径包；共享契约/依赖由Leader维护。发生同类隐私授权问题后先扩大来源闭包与每步检查诊断，再集成，未以重置repairCount规避。规则已沉淀在[多Agent开发规则](../engineering/MULTI-AGENT.zh.md)。独立复核的实际运行与读取Leader日志分别记载，不把读取日志写成独立重跑。

`34ff4ce`整套中的一次Unexpected end JSON来自测试observer跨进程读取truncate/write窗口；保留该失败日志，改为完整JSON写同目录临时文件后rename发布。产品Store、Session及原断言未改变。随后排队恢复1/1及新完整237/237通过，不把该夹具修正记为产品行为Red。

本次不证明真实公司数据质量或业务收益，也没有迁移真实旧数据、云部署、通用Excel/BI或Amazon/ERP自动写入。所需本机凭据不入Git，后续使用继续保留请求级实际记账。
