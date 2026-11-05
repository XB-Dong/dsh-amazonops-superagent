# P1 分阶段验收与发布门槛

2026-11-05执行结果：G0–G4已实际完成并独立接受，39项及61条阶段记录通过，P1 completed。以下是已执行的门槛定义；准备阶段描述保留为历史，不代表继续等待授权。首次真正定时触发仍与配置恢复、实际手动检查分别记录。

39项强制验收用于最终完成，不是全部生产变更的先决条件。矩阵每项有evidenceStages和stageResults；尚有后阶段未运行时整体case为not_run或partial，不得提前passed。每个阶段只要求该阶段的实际证据通过，不依赖未来事实。

## G0 启动与旧研发静止

明确启动后，S0暂停既有同ID每日触发，保存最新配置并排空实际旧Leader/开发者/排队触发。旧业务服务继续使用和收建议。当前准备阶段不做此操作。G0通过后才运行新产品writer；云端指纹与私有输入仍须核实。

## G1 发布候选（pre_release / S4）

所有pre_release分项证据通过，包括Windows/Linux固定依赖和真实原生测试、隔离HTTPS/权限、迁移合成演练、watch/rule/人工行动、必要真实模型、浏览器及收益记录、精确候选CI。独立P1-REVIEW接受releaseCandidateReview后，才冻结不可变发布包。此时不要求实际切流、真实建议最终迁移、主页发布或automation恢复已通过。

## G2 开放生产写入（cutover / S5）

G1已通过。先冻结旧业务全体写者并排空，最终一致性快照→候选重建→最新隐私和用量合并→源目标全量逐项零遗漏/重复/未解释差异→隔离读取安全和身份校验。此pre_open检查通过才能切流并开放新写入。随后验证真正公网TLS/登录/WS、精确运行版本、切换后新建议持久化和重启。cutover阶段完整通过才进入接替；不能把开放后的检查结果当成开放前已具备。

## G3 业务接替（handover / S6）

新生产已接受数据且G2实际通过。既有automation保持PAUSED，同ID更新prompt和私有权威；由发布Leader显式执行handover_validation实际只读检查（零模型/波次/开发），不发新的研发指令。停旧服务/后台/旧维护路径，保留恢复资产；按最新README SHA更新个人主页/新README/旧退役说明并读回。P1-CLOSEOUT独立审核本阶段及生产证据，返回businessHandoverReview，不以尚未恢复ACTIVE为拒绝审核的理由。

## G4 最终收口（closeout）

G3独立接受后，Leader将businessDelivery标为completed（最终P1 phase仍executing），同ID恢复既有automation ACTIVE并读回原时间/target/通知和新prompt。维护prompt正常开发仅在businessDelivery completed且新权威有效时允许，handover_validation始终只读。若恢复失败，保持整体partial并修复，不能把P1完成标记用于绕过失败。

独立读回closeout证据；所有39项及其全部阶段证据passed后才将P1 phase改为completed。配置恢复和实际调度触发分别记录，首次真正定时运行未发生时如实写未运行，不将其伪造成交付证据。后续维护仍遵守单Leader锁。
