# 本机隔离与访问控制

前置规格 v0.1。当前不启动服务，不读取任何模型 Key 或生产连接配置。

## 运行隔离

未来本机执行使用独立 DSH_HOME、SuperAgent stateDir、业务 dataDir、模型测试账户和 loopback 端口，全部从新项目配置解析；禁止符号链接/路径穿越回旧运行目录。不修改系统级 PATH、Git 身份或旧服务，原生 Windows 必须实测。看到 wsl.exe 仅说明命令存在，不代表已有可用发行版，本方案不把 WSL 当已验证前提。

不运行 cloud/SSH、生产快照、备份或反馈读取，不迁移旧自动任务。新的运行时不持 GitHub/SSH 凭据，GitHub 仅由研发终端用于已授权的新仓库维护。

## 认证必须覆盖全部入口

DSH webserver 是路由载体，不提供可直接继承为本产品业务授权的全局认证。SuperAgent 本机管理路由的 Host/Origin 检查也不等于用户身份或 scope。设计使用服务端统一入口认证及能力判定，覆盖页面数据、业务 Command/Query、Source 提交、DSH 会话/RPC/流式/附件和管理配置。

P0 必须通过原生认证 Remote 或 ingress 中间件实验核对所有路由；具体全局 hook 尚未运行验证。若不存在可覆盖原生路由的受支持接缝，需登记单独的有界 DSH host 补丁并独立审核。不能只给业务 route 加 Cookie、留下原生 API 绕行，也不能用隐藏导航替代拒绝。

同源写请求校验精确 Origin；Cookie 使用 HttpOnly/SameSite，TLS 环境才设置 Secure；本机 loopback 测试不能冒称公网 HTTPS。匿名访问和错误 Origin、令牌、scope、对象归属均有负向用例。默认单 operator，不能证明个人作者，也不实现未经需求确认的多租户。

## 运营权限

运营用户和 Agent 不能读凭据、任意文件/SQL、运行 shell、安装插件、改源码/提示政策/模型账户或管理上游部署。只允许明确 cc 工具及必要编排上下文/报告工具。继承 allowlist、agent-local tool 和 guard 需联合验证，新建/恢复/派工更换/HMR 均一致。

初始运营会话不启用子 Agent；如果后续 P0 方案确实需要，在同一 P0 内先规格化权限继承和反向用例再启用，不默认落回 standard preset。研发分析 Agent 与产品运行时 Agent 不共用权限或身份。

## 模型调用

统一 llm/stream 拦截路由研判、worker、压缩、标题及任何其他实际模型请求。请求前 durable reserve，结束/失败/取消后 settle，缺 usage 保留 unknown/预留，不算零。与原生日志交叉对账，无未登记出口。禁 llm-retry 和 SuperAgent 自动模型续调，保留超时和单轮循环保护。

必要未来测试不设累计费用/请求/token 人为上限，离线优先，完成有限目标后停止。runtime 日常保护与测试账户分开，不能借旧日常账户、伪造清账或覆盖历史。准备阶段零模型调用。
