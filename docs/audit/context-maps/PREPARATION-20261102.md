# Context Map · SuperAgent 重构项目前置准备

2026-11-02（Asia/Shanghai）。用户授权建立独立 GitHub 仓库，以官方 SuperAgent 为底座复现 ccagent。本次止于 P0 执行计划前；未来 P0 的完成定义为整套重构及功能测试正常，后续波次不安排。

## Files to Modify

| File | Purpose | Changes Needed |
| --- | --- | --- |
| README.md、AGENTS.md、CONSTITUTION.md、NEXT-WAVES.md、THIRD-PARTY-NOTICES.md | 新项目入口和工程规则 | 独立定义本轮授权，不继承旧项目部署或自动推进权限 |
| docs/product/REQUIREMENTS.zh.md、docs/product/changes/2026-11-02.md | 产品需求与日期记录 | 按实际交付行为建立完整复现范围，保留候选和未交付边界 |
| docs/discovery/ | 现状与重构分析 | 功能清单、旧代码依赖、上游固定基线及扩展点 |
| specs/、specs/contracts/ | 架构与契约 | 原生宿主、SuperAgent 实际复用、业务模块、工具、数据、安全和迁移边界 |
| docs/testing/、docs/preparation/ | 验收设计和准备状态 | SDD/TDD、多 Agent 分工、前置审核及 P0 就绪条件 |
| docs/audit/reviews/、docs/audit/reports/ | 独立审核与处置 | 真实执行者、发现、修订及准备结果 |
| scripts/verify_preparation.py、.github/workflows/preparation.yml | 文档工件验证 | 需求/验收追踪、链接、隐私、状态诚实性和仅准备限制 |
| .gitignore、LICENSE | 仓库治理 | 禁止运行数据、凭据、真实反馈、生成经验和 worktree 入库 |

## Dependencies (may need updates)

| File | Relationship |
| --- | --- |
| ccagent：bc964298d49ad399ae325f57068c9149502b8c62 | 只读旧系统参考；现有研究文档未提交改动保留，不复制旧历史 |
| ccagent/packages/cc-harness-adapter/{runtime.ts,profile.ts,plugin.mjs,gateway.ts} | 现有官方 SDK、9 个工具、Skill Provider、模型入口 |
| ccagent/apps/server/{app.ts,business.ts,chat.ts,operations.ts} | 宿主、分派和业务生命周期，识别重构边界 |
| ccagent/packages/{operations,learning,core} | 确定性规则、学习、持久化、删除与恢复 |
| ccagent/apps/web、tests | 已有界面行为和可复用回归案例；旧通过结果不算新项目通过 |
| SuperAgent：6337fc823ce20251c8de8085948165c81aaa701e | 原生 Runtime、Engine、Source、Ticket、Assignment、执行器及页面 |
| Harness：ce7073d51254c26cd63b22a60835b8f948deb447 | 原生 profile/bundle、宿主、会话、工具、模型、权限与客户端扩展 |

## Test Files

| Test | Coverage |
| --- | --- |
| 新项目 scripts/verify_preparation.py | 仅前置工件检查；不称为产品功能验收 |
| 旧 tests/task-copy.test.ts、task-list-view.test.ts、p43-harness.test.ts | 复制、北京时间、工具集成的迁移验收参考 |
| 旧 tests/learning.test.ts、privacy-closure.test.ts、recovery.test.ts | 来源、撤销删除和恢复的迁移验收参考 |
| 旧活动、报表、库存、分配、发货和广告测试 | 已交付规则基线，未来迁入后重新运行 |

## Reference Patterns

| File | Pattern |
| --- | --- |
| 旧项目 CONSTITUTION.md 和日期需求记录 | 规格先行、真实 Red/Green、版本追踪；历史预算/部署授权不照搬 |
| 旧项目 docs/waves/ | 计划与任务按波次归档；本次不创建 P0 执行计划 |
| SuperAgent src/core/ports.ts、src/index.ts | 原生核心接口及根入口导出，避免另造 Agent loop |
| SuperAgent src/client/index.tsx | 原生主面板及侧栏注册 |

## Risk Assessment

- [ ] 修改旧应用公开 API：本轮不修改应用代码。
- [ ] 迁移生产数据库：本轮不接触任何生产或真实业务数据库。
- [ ] 修改云配置或定时任务：本轮禁止。
- [x] 上游开发预览与版本兼容尚未实测，必须留作后续启动门槛。
- [x] 编码执行器和运营执行器权限不相同，不能只改提示词。
- [x] 业务任务与编排工单不是同一实体，不合并数据库生命周期。
- [x] P0 包含全部已交付功能，不能仅做底座后将剩余功能推给下一波。
- [x] 本轮准备截止不能被旧项目连续执行授权覆盖。

Leader 自审：地图覆盖当前允许写入的文档、准备检查与仓库配置；源码实现、依赖安装、模型调用、云连接、自动任务变更均不在本轮。两名发现 Agent 只读，Leader 单写共享工件，随后独立只读审核；无需为只读任务建立写入 worktree。
