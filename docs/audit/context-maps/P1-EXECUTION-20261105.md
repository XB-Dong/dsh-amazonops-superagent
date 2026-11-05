# P1 执行 Context Map

2026-11-05，Asia/Shanghai。用户本轮明确“启动”，准备基准 `ccb36eef91787aa8e53854e02e247ab9f5475b15`，产品基准 `9ef48273d88d309c361557f942b20da1882ded52`。

## Files to Modify

| File | Purpose | Changes Needed |
| --- | --- | --- |
| AGENTS.md / CONSTITUTION.md / NEXT-WAVES.md / docs/waves/P1/** | 当前执行授权、任务和证据 | 记录新启动，刷新精确任务基准和接口输入，按G0–G4验收 |
| packages/contracts/model.ts / specs/contracts/** | 客户端与业务/原生接口 | 冻结工单责任、人工行动、watch与规则DTO |
| packages/host/index.ts / source.ts / operations.ts / agent-tools.ts | 原生集成 | 公共Origin、安全cookie、健康/迁移模式、受限人工动作、可信业务事件续办 |
| packages/business/** | 跟进授权、游标、幂等、风险规则 | 纯领域、单写、scope/隐私/到期/停止校验 |
| scripts/recovery.ts / scripts/migration*.ts / packages/business/core/migration*.ts | 离线迁移与全量对账 | 完整实体和墓碑、pending队列、私有登记、最终刷新与输入不变 |
| packages/client/** | 中文责任及持续工作体验 | 原生权威投影、人工动作、watch/规则状态、真实浏览器验证 |
| profiles/** / deploy/** / scripts/start.mjs / scripts/build.mjs / .github/workflows/** | Linux、安全发布和CI | 实际原生探针、完整发布manifest、固定依赖、服务与受控反代 |
| README.md / docs/operations/** | 上线及接替说明 | 只在事实成立后发布完成态，保留许可证/历史 |

## Dependencies (may need updates)

- 旧私有运维索引和SSH主机指纹、完整反馈登记、实际云端schema/写者：只在私有存储解析和留证，禁止入Git。
- 同ID既有每日维护任务：S0已通过工具暂停，原维护聊天只读核查为空闲；S6按原时间/目标/通知恢复新权威。
- SuperAgent原生Ticket/Mandate/Assignment/attention/Store/Effects，DSH原生Session唯一对话权威；不新建循环，不修改15个core。
- 旧业务保持服务，最终切换前才冻结业务写者；原有研发写者/排队触发须先排空。

## Test Files

| Test | Coverage |
| --- | --- |
| tests/business/** | 授权、状态、计算、scope/幂等/过期/撤销 |
| tests/integration/** | 真原生事件链、迁移WAL/队列/指纹、重启/恢复/权限/账本 |
| tests/native/** | Linux及Windows启动与生命周期、工具和目录边界 |
| tests/client/** | 纯展示与交互状态；浏览器实际动作另留私有证据 |

## Reference Patterns

[准备地图](P1-PREPARATION-20261105.md)、[P1计划](../../waves/P1/PLAN.md)、[规格](../../waves/P1/SPEC.zh.md)、[分阶段门槛](../../waves/P1/GATES.zh.md)、[协作规则](../../engineering/MULTI-AGENT.zh.md)。P0历史验收不作为新平台通过证明。

## Risk Assessment

- [x] 共享DTO/API改动，Leader冻结后独立worktree分派。
- [x] 真实业务/建议/隐私/队列迁移，最终完整对账，不依赖更新时间或revision。
- [x] Linux和HTTPS配置、生产切流、维护接替，所有副作用按G1/G2/G3顺序。
- [x] 开放写入后回退须保留新数据，禁止直接恢复旧快照。

## Review

Leader已在产品编辑前自审本地图、准备审核和G0–G4。先取得当前事实及契约再派发；私有原始数据、凭据和服务器标识不输出、不入Git；必要模型测试独立账本、无自设累计消耗上限、零自动重试。
