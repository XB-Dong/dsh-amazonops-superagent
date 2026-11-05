# Linux 发布模板

模板不是当前生产事实，不直接替换既有入口或证书配置。由发布Leader从私有索引核实当前主机、指纹、服务、入口和备份后，按P1 G0–G4实施。旧业务服务在最终切换前继续使用。

## 安装与目录

固定官方Node24.22.1、pnpm11.25.0和lockfile；先核对官方分发校验，再安装到新tooling目录，不能覆盖旧Node。新专用系统账号无登录shell；代码放入不可变releases目录，通过current代码链接选择版本，home/state/data不在代码目录。示例home和config权限0700/0600，代码只读。产品进程无GitHub/SSH凭据；模型Key只在受限EnvironmentFile的AMAZONOPS_API_KEY字段，不能放settings.json或Git。

settings.json的publicOrigin必须是明确的canonical HTTPS origin，无末尾斜线、路径、用户名、查询或fragment；绑定地址仍为127.0.0.1。缺省publicOrigin保持本机行为。端口、生产密码和runtime策略须从实际批准配置安全迁入，示例字符串不能作为生产密码。

## 验证发布包

干净精确提交执行frozen install、类型、构建和实际测试。build-manifest.json保留原应用产物记录，release-manifest.json另覆盖应用/native产物、锁文件、patch、profile、launcher、相关源码和许可证。生产launcher启动前重新验证清单路径/全部bytes/hash、完整source SHA和sourceDirty=false；不能通过环境变量自报发布身份。不要在构建后修改清单内代码、配置模板或打补丁；必要变更重新提交构建。

## 隔离与迁移

新候选使用独立端口/home，不共享旧进程可写目录。migrationMode=true时launcher不向子进程传模型Key，profile强制live=false；宿主须进一步禁Source接单、后台tick和写API，仅允许受认证的只读快照/状态/工单，以及最小health/ready。候选不能通过原生管理RPC写入。不要为了冒烟打开main的后台消费者；使用合成资料和独立实例验证后再导入最终生产快照。

## HTTPS 与健康

反代保留公共Host、Origin和WS Upgrade，SSE不缓冲；不把任意客户端X-Forwarded-*作为鉴权依据。应用和原生RPC/WS使用同一个明确publicOrigin，HTTPS会话cookie须Secure/HttpOnly/SameSite=Strict。登录失败限流默认按直连socket地址共享，不能盲信伪造转发IP。/health和/ready只允许GET/HEAD且仍校验Host/Origin，最小响应只含状态和已验证发布身份。

## 生命周期和恢复

systemd模板通过专用账号、只读系统、独立home、UMask0077及control-group关闭约束整个DSH进程树；先在实际Linux验证SIGTERM、重启、权限和路径护栏。应用只开放最小业务权限。备份必须协调原生owner和SQLite/WAL，恢复至独立新目录并验证隐私/预算/Session cwd；代码回退不能回退数据。新入口接受写入后的失败必须保留新增建议、墓碑、隐私和用量，不能直接指向旧快照。

云切流、停旧服务、最终建议对账和每日任务接替均由Leader执行。部署模板生成或离线测试通过不等于已上线。
