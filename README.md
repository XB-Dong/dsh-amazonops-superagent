# dsh-amazonops-superagent

基于官方 DeepSeek Harness 与 dsh-superagent-prototype，重新组织并完整复现 ccagent 的中文运营工作台。

当前为本机前置准备阶段，停止于 P0 执行计划编写前。P0 的目标是完成整个重构并通过功能测试；本次尚未实现应用、安装产品依赖、调用模型或修改云端。原 cc 工作台继续运行。

启动追加：用户已于2026-11-02明确启动，现按 [完整P0执行计划](docs/waves/P0/PLAN.md) 进入本机开发。上段为此前准备交付事实；当前进度看 docs/waves/P0/state.json，云端与旧自动任务继续不动。

入口：[文档导航](docs/README.md)、[业务需求](docs/product/REQUIREMENTS.zh.md)、[工程规则](AGENTS.md)、[开发宪法](CONSTITUTION.md)、[阶段边界](NEXT-WAVES.md)。

新仓库独立建立，不复制旧 Git 历史。GitHub 默认先建私有仓库；未获得公开发布指令前保持私有，并按可公开代码的隐私标准维护。
