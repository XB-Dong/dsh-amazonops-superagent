# P1 准备 Context Map

2026-11-05，Asia/Shanghai。产品基准 `9ef48273d88d309c361557f942b20da1882ded52`。当前仅准备，等待用户启动。

## Files to Modify

| File | Purpose | Changes Needed |
| --- | --- | --- |
| AGENTS.md / CONSTITUTION.md / NEXT-WAVES.md | 当前授权与阶段入口 | 追加 P1 准备边界，保留 P0 历史；未来部署与停维护等待启动 |
| README.md / docs/README.md | 公开入口 | 记录公开仓库事实，链接 P1 准备；不提前声称云端上线 |
| docs/product/changes/2026-11-05.md / docs/product/REQUIREMENTS.zh.md | 日期需求与当前需求 | 追加 P1 交付目标，不改变已通过 P0 的范围及证据 |
| docs/waves/P1/** | 计划、规格、任务包、验收、状态、就绪报告 | 完成可审阅准备，所有产品与生产验收初始 not_run |
| docs/audit/reviews/P1-PREPARATION-20261105.zh.md | 独立准备审核 | 记录实际审阅、发现及处置，区别产品验收 |

## Dependencies (may need updates)

| File | Relationship |
| --- | --- |
| packages/host/source.ts / operations.ts / agent-tools.ts | 当前只允许认证 human_request；未来持续跟进须扩展准入与授权，不能直通所有事件 |
| packages/contracts/model.ts / packages/client/Assistant.tsx | WorkSnapshot 工单摘要与原生会话入口，未来扩展有来源的执行状态 |
| packages/business/core/recovery.ts / scripts/recovery.ts | 离线恢复，不是在线增量合并；迁移清单、最终对账待实现 |
| packages/host/index.ts / packages/business/core/privacy.ts | 自动 tick、删除/撤销、恢复隐私闭包，迁移阶段需隔离后台消费者 |
| scripts/start.mjs / profiles/local.ts / packages/host/boundary.ts | 当前仅本机 loopback、精确 Host/Origin；Linux 和 HTTPS 代理不能假设已适配 |
| vendor/superagent/src/core/** / src/operations.ts | 原生工单、授权、订阅、worker 报告；ready 结束无 PR 工单，持续跟进需明确 waiting 生命周期 |
| .github/workflows/preparation.yml / scripts/verify_preparation.py | Windows CI 和全仓隐私/链接/溯源检查；准备检查不能替代 Linux/生产测试 |
| 旧项目的运维索引、反馈登记与生产读取缓存 | 本地受限证据；只做脱敏现状分析，原文/真实ID/地址/路径不入 Git |
| 现有 Codex 每日维护 automation | 同 ID 切换，保留时间/目标/通知及历史；当前只 view，不改状态或 prompt |
| GitHub 个人资料 README | 已核实仍介绍旧 ccagent；准备替换文案，待启动且事实验证后发布 |

## Test Files

| Test | Coverage |
| --- | --- |
| tests/business/** | 导入、任务、反馈、隐私、幂等和版本化历史 |
| tests/integration/** | 真实原生链路、恢复、来源准入、权限、模型账本 |
| tests/native/** | 原生启动、生命周期、工具与跨平台目录护栏 |
| tests/client/** | 展示纯规则；未来实际浏览器另留交互证据 |
| scripts/verify_preparation.py | 当前工件、隐私、链接与上游 core 哈希；不验证 P1 产品 |

## Reference Patterns

| File | Pattern |
| --- | --- |
| docs/waves/P0/PLAN.md / state.json / tasks/** | 冻结任务包、依赖、基准、真实状态 |
| docs/engineering/MULTI-AGENT.zh.md | 隔离写入、Leader 契约、独立审核和真实 Red/Green |
| docs/testing/EXECUTION-20261102.md | 证据分层、未知用量不当零、产品/生产事实分开 |
| vendor/superagent/docs/001-domain.md / 002-authorization.md / 003-execution.md | 事件上下文不授予权限；工单订阅、授权和恢复机制 |

## Risk Assessment

- [x] P1 将新增 API/DTO 与来源准入；准备阶段不修改运行代码。
- [x] P1 需要真实数据迁移；禁止把合成迁移通过当作生产完整迁移。
- [x] P1 需要 Linux、反代、Origin/cookie、服务与维护配置变更；等待启动。
- [x] 最新建议不能仅凭 revision/updatedAt：旧撤销可不增版本，必须完整集合、payload 指纹、墓碑与队列对账。
- [x] 云端实况尚未查询；本地缓存只有采集时效，不保证当前实时性。

## Review

Leader 已在编辑其余准备材料前完成自审：本次只写文档与准备状态，不改产品代码、私有反馈登记、旧项目、维护 automation、个人主页或云端。后续独立审核针对准备候选，不冒充产品验收。
