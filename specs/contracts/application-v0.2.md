# 本机应用集成契约 v0.2.0

2026-11-02｜P0 共享接口。domain/tools v0.1 的全部行为继续有效。

## Business 服务

入口 packages/business/index.ts 导出 Business(dataDir)、业务类型与 Store/ModelBudget/备份恢复接口。Business 拥有 store、learning 等领域服务。snapshot(scope) 纯只读；command(scope, action, input) 接收稳定 requestId 和 revision，复现旧页面 action；tick(scope) 显式消费捕获/成功事件/活动提醒，Query绝不调用它。tool(scope, sourceId, action, input, operationId) 对三个写工具注入可信 operationId，不能以 Assignment 或临时调用ID替代。

业务和页面数据保持原已交付字段语义；纯 DTO 放 packages/contracts/model.ts，客户端不得从 packages/business 或 host 导入实现。模块重组可改变内部文件路径，不改变可观察业务行为。领域Task类型属于任务，learning消费已提交的成功事件，不反向控制任务领域。

## 原生宿主路由

全部注册在 DSH webServer 上，不另造独立聊天HTTP宿主。统一前缀 /amazonops/api，写请求 JSON 并校验 Origin。服务端认证固定 operator/main scope；测试通过可信会话创建第二scope，不接受任意workspace header。

| 方法/路径 | 请求 / 响应 |
| --- | --- |
| POST /login | {password} → {authenticated:true} 与HttpOnly会话Cookie |
| POST /logout | 清除认证与Cookie |
| GET /status | {authenticated,scope,live,modelState,budget,version}；模型状态真实 |
| GET /snapshot | 旧页面领域数组+summary+learningEnabled，纯只读 |
| POST /actions/:action | 旧页面command输入，含requestId/revision；返回业务结果 |
| POST /messages | {text,requestId,threadId?} → {messageId,threadId,ticketId?,sessionId?}；持久Source请求，不因浏览器断开取消 |
| GET /work | 当前scope的原生工单、必要会话引用和Channel消息；无独立对话正文权威 |
| POST /cancel | {ticketId}，显式幂等取消，禁止迟到写入 |
| POST /backup | 本机协调checkpoint，返回不含任意私密路径的下载/状态引用 |

匿名/status可返回401；登录之前本地欢迎/登录壳不需要模型。原生DSH会话、stream、RPC、附件和管理路由也必须通过相同认证/能力边界；若公开hook不足采用有界host适配，不能泄漏原生绕行入口。

## Client

packages/client/index.tsx 注册DSH原生主面板和侧栏。React构建只保留一份宿主兼容版本；可迁移旧页面组件及CSS，替换传输/共享DTO，不能重建独立React应用宿主作为交付。原生Session通过会话入口打开；运营助手页面显示Source请求、工单/Channel结果、继续/取消，工单ready不标业务任务完成。

## 当前分工边界

后端独占 packages/business/**、tests/business/**；前端独占 packages/client/**、tests/client/**；底座适配独占 vendor/superagent/**、profiles/**、tests/native/**。Leader独占共享contracts、根依赖/锁文件、host、integration测试、波次状态和最终集成；需要改共享契约先回报，不跨路径写入。
