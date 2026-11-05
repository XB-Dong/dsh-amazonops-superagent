# P1 工作台 HTTP / 原生投影接口 0.3.0

共享DTO为packages/contracts/model.ts中的WorkTicket/WorkAction及followups.ts；旧字段保持兼容。所有入口认证、固定main scope和精确Origin，模型离线时领域表单继续可用。

- GET /amazonops/api/work?offset=0&limit=20：原生工单分页，返回WorkSnapshot和pagination（offset,total,nextOffset），stage/mandate/attention/assignment/source/actions来自当前Engine。消息继续用原生Trigger/outbox，不建立第二消息库。未分页旧调用保持可用。
- POST /amazonops/api/work-actions：WorkAction。所有写操作携带requestId及当前expectedUpdatedAt，answer额外attentionId与text。可见actions只是提示，服务端重查原生状态与授权。重复相同请求返原回执；变参/过期/越区/无效动作拒绝。answer与supplement成为该工单原thread上的认证human_request；retry/stop调用实际Engine。过期答复不误答新attention。
- GET /amazonops/api/followups：FollowupSnapshot，纯查询，不消费队列。
- POST /amazonops/api/followups/create：WatchCreate；服务端生成human source、领域授权和真实原生请求，不接受伪造sourceId。需要模型可用且存在明确inventory/有效期限。UI不替用户无限期授权。
- POST /amazonops/api/followups/stop：{requestId,id,revision}，停止领域授权并停止对应真实工单；即使模型离线也应可停止。
- POST /amazonops/api/followups/rule：{requestId,mode,inventoryIds}；只配置唯一库存复核规则。未配置显示observe及空对象，不自行勾选所有方案。auto由服务端实际验收门槛控制，不能仅靠前端开关。保存前提示允许做的仅内部复核草稿。

前端在运营助手页面展示真实责任卡及人工动作，可建立库存跟进（从现有data.inventories选择、明确本地输入→ISO到期时间）及唯一规则。补充/答复草稿按ticket/attention持久在页面状态，筛选/刷新/折叠不能丢失；成功或取消才清空。动作成功读回真实状态，不乐观标业务任务完成。采用可解释中文，核心页不堆砌Runtime/Mandate等底层术语；可展开详情查看授权范围/期限/执行记录。

默认observe可能调用原生评估模型但零worker/业务草稿写入；不要显示零费用承诺。自动模式不可用时说明尚未通过启用检查，不模拟成功。所有错误保持既有安全映射，不能回显内部信息。
