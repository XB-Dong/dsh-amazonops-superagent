# 本机构建与启动

## Context Map · P0 packaging

Baseline 8f717e6432622e217a05f0971dfb3e014e903968, application contract v0.2. The packaging subtask owns build/start scripts, local profile, vendor entry/package metadata and the packaging test only. Root owns host/client code and root package metadata.

| File | Purpose | Change |
| --- | --- | --- |
| build.mjs | Reproducible native/client builds | Vendor outputs retain their package asset root; native client uses the host React |
| start.mjs; ../profiles/local.ts | Local launcher | Independent private settings/home, loopback, scrubbed environment and output |
| ../vendor/superagent/{package.json,src/index.ts,patch-manifest.json} | Native integration | No old coding client; delegate current hooks at use time |
| ../tests/native/packaging.test.ts | Behavior and build validation | Settings preservation, secret redaction, output layout and native client wrapper |

Dependencies are the Leader's pinned DSH rc.3/React/esbuild graph. Existing operations profile and native startup test are the reference. No cloud, old writes, credentials or dependency changes. Self-review completed before packaging edits; build/runtime output stays ignored or in the caller's isolated home.

## 使用

执行 `node scripts/build.mjs` 构建；执行 `node scripts/start.mjs` 启动官方 DSH Web 宿主。默认私有配置目录由当前用户主目录下的 `.dsh-amazonops` 提供，可通过 `AMAZONOPS_HOME` 指定新的独立绝对目录。首次生成随机登录密码到该目录的 settings.json，终端只打印文件位置，不打印密码。

`AMAZONOPS_PORT` 指定 loopback 端口，默认4315。模型Key仅从 `AMAZONOPS_API_KEY` 读取并传给子进程，不写配置。没有Key则离线运行。模型测试账户默认test；不得借旧生产账户或运行目录。浏览器登录入口为 `/amazonops/login`。

目录中 data 包含业务库、data/harness 原生DSH和 data/superagent 编排数据，使协调备份能覆盖所有所有者。settings.json 含本机登录密码，应仅由当前用户读取；Windows访问权限以实际用户目录ACL为准，不将POSIX mode等同NTFS隔离保证。关闭进程会清理本次临时启动patch；异常退出遗留文件仍在私有目录，不在Git。

## 协调快照接缝

原生 Runtime.checkpoint(capture) 先等待原生停止、会话 flush 和编排库关闭，再执行 capture；成功或失败后都请求构造器提供的回调重建原生 fiber。它不声称返回时新服务已经 ready。宿主须在整个维护窗口拒绝新写入，并等待新的 orchestrator 服务 ready 后再恢复入口。

真实原生测试已验证捕获期间旧SQLite已关闭，以及成功/失败两种捕获后各重建一次 provider。此处不是数据备份完整性证明；业务/文件/hash/删除账本的整体验收仍由宿主负责。
