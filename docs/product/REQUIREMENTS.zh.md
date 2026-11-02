# 中文运营工作台 · 重构需求

版本 0.2.0｜2026-11-02｜阶段：本机P0完成。

使用者为 cc。目标是以 SuperAgent 的真实编排和 DSH 原生应用能力承载中文运营工作台，保持旧系统已交付行为，改善代码组织、任务持续执行和维护边界。当前日期指令见[追加记录](changes/2026-11-02.md)。

## 完整 P0 范围

| ID | 复现目标 / 边界 | 当前产品状态 |
| --- | --- | --- |
| CC-ENTRY-001 | 中文问候、能力入口、例句、使用说明；离线可用表单；不展示研发管理 | implemented_verified |
| CC-HARNESS-001 | 原生会话、流式、压缩、工具、恢复和显式取消；完整用量 | implemented_verified |
| CC-TASK-001 | 草稿确认、任务编辑/状态/勾选/用时/站点排期；北京时间日期筛选；保留未保存输入 | implemented_verified |
| CC-TASK-COPY-001 | 完整分页读取、字面替换预览和复制草稿；清空执行字段，保留来源及冲突/幂等保护 | implemented_verified |
| CC-WORKLOG-001 | 完成日期工作日历、所选时区、实际用时修正及汇总；缺失不当零 | implemented_verified |
| CC-NOTES-001 | 纯文本笔记新增/修改/搜索/删除；不自动发模型或变成经验 | implemented_verified |
| CC-ACT-001 | 活动准备/切换/生效检查/恢复四阶段及内部提醒；人工确认实际状态 | implemented_verified |
| CC-DATA-001 | 仅复现已落地 CSV 预览/映射/质量/批次/幂等导入；更广 Excel/商品映射仍候选 | implemented_verified |
| CC-INV-001 | 已有 7 日基线或带原因人工预测、版本、按日库存/入库/活动/缺货与建议 | implemented_verified |
| CC-SHIP-001 | 实物批次池、共享唯一分配、日期窗、前置清单、字段复用、人工双号与到货 | implemented_verified |
| CC-ADS-001 | 确定性广告指标、分组、币种、归因/成本条件、建议及导出 | implemented_verified |
| CC-FEEDBACK-001 | 来源捕获、精确归并、计次、补充/修订、归类及撤回；不自动授权研发 | implemented_verified |
| CC-MEMORY-001 | 已确认事实/推断分开、更正替代、scope 检索、可重建摘要和删除 | implemented_verified |
| CC-SKILL-001 | 确认成功流程派生、L0 校验启用、L1 确认、撤销与受控 Provider；L2 拒绝 | implemented_verified |
| CC-HISTORY-001 | 日期需求、版本化脱敏审阅包及稳定变更 ID；运行产品不持 GitHub 凭据 | implemented_verified |
| CC-ANALYSIS-001 | 仅复现有来源/日期/截断元数据的运营摘要；通用 BI/任意代码分析仍候选 | implemented_verified |
| SA-NATIVE-001 | 实际使用 SuperAgent Runtime/Engine/工单/派工/Store/Effects；原生 DSH 宿主及客户端 | implemented_verified |
| SA-ACCESS-001 | 登录、Origin、可信 scope、角色/工具限制、CAS、幂等及管理能力隔离 | implemented_verified |
| SA-RECOVERY-001 | 多存储协调备份/恢复、删除撤销不复活、用量不退还、隔离迁移验证 | implemented_verified |
| SA-LOCAL-001 | 本机原生 Windows、独立目录/端口/账户；旧项目与云端保持原状 | implemented_verified |

每项行为和排除内容见[功能矩阵](../discovery/FEATURE-PARITY.zh.md)，每项可观察验收见[验收矩阵](../testing/acceptance.json)。历史功能不等于新项目已经通过；也不承诺真实公司数据质量或 Amazon/ERP 业务效果已经验证。

## 保留但不实施

CC-CUSTOMER-001 保持待重新设计，不进入 P0。个人任意排序和“仅本人视图”待身份与保存范围确认。通用 Excel、自动商品映射、通用表格问答/BI、外部自动建单/改价/改广告/发消息不进入本次复现。

所有已交付能力必须在同一 P0 完成；没有 P1/P2 占位。仅可将有歧义且旧系统也未交付的部分明确排除，不能借候选身份删除已经实现的 CSV 和摘要子集。
