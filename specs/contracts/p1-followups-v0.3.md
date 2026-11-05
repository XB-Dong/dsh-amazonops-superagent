# P1 库存跟进领域接口 0.3.0

Leader冻结DTO见packages/contracts/followups.ts。当前产品唯一scope为main，但领域必须拒绝跨scope引用。领域模块不依赖Runtime/HTTP/React/模型；编排负责生成真实Ticket和投递后ack。

## 服务接口

新增packages/business/followups/index.ts导出Followups，构造Followups(store, clock?:()=>Date)。服务方法：

- create(scope,input:WatchCreate,sourceId:string):InventoryWatch。必须从同scope现有inventory和认证human source派生；sourceId由可信host提供，不接受用户伪造source。expiresAt为严格有限ISO未来时间，缺对象/过期/跨区拒绝；稳定requestId有指纹变参冲突。保存完整业务身份store/site/listing/physicalSku及sources。
- get(scope,id):InventoryWatch；list(scope):InventoryWatch[]；bindTicket(scope,id,ticketId):InventoryWatch（可信适配调用，重复相同绑定幂等，不得换绑）；stop(scope,id,revision):InventoryWatch（CAS，停止后不能继续写）；expire(scope):void（无模型，实际到期持久expired）。
- risk(scope,inventoryId):RiskSnapshot。重新读取当前有效库存/预测，严格校验kind/scope/来源/墓碑；同业务身份后续inventory版本可被watch发现。可使用最新有效匹配forecast重算现有库存计划，但不得把新CSV本身猜成已确认预测。确定性projectInventory复用，digest忽略无业务变化的时间/内部元数据，summary给可核对的关键指标，缺失拒绝猜测。
- rule(scope):InventoryRule|null；configureRule(scope,{requestId,mode,inventoryIds},sourceId):InventoryRule。唯一明确对象白名单规则，缺省未配置等同observe但不凭空选择对象；off不产候选。更改规则有稳定请求指纹和source授权引用，auto启用门槛由host执行。
- scan(scope):void；pending(scope):FollowupEvent[]；markDelivered(scope,eventId):void；snapshot(scope):FollowupSnapshot。scan只处理白名单business:inventory/business:forecast/business:report-import等与明确对象相关的新事件。持久consumer游标与FollowupEvent outbox在同一业务事务提交；scan可合并积压但不丢有效变化。pending仅返回当前仍授权、未过期/未撤销及风险事实仍有效的事件，过时事件不可执行。markDelivered幂等，不能借重复ack修改payload。

## 事件和去重

watch事件只发给已授权active watch；相关风险实质变化才新建outbox，同一风险事实即使多事件/重启也只一次。proactive仅对规则白名单且确定性stockout风险生成候选，规则observe也只是risk_candidate，不能写任务草稿或启动worker。已有覆盖该业务身份的active watch时不再产重复proactive工单，交由watch消费。规则版本/模式变化要可重新评估但不能让回执或规则自身修改无限触发。

原始业务事件只有引用，重新读事实；回执/tick/助手输出/feedback/学习事件不触发。watch/rule/outbox/consumer写入不再append可触发自己的business事件。稳定eventId基于可信scope、watch或规则、相关业务风险版本（区别重新派工/临时toolCallId），不能只按随机UUID。需要用户决策时由编排原生attention承接，不在领域伪造attention。

## 隐私与恢复

sources保留完整source/对象引用以进入现有隐私闭包；pending/get/risk执行时再次检查墓碑和source有效性。撤销/删除/过期/人工停止后的旧outbox重放拒绝，不复活已结束工单。业务scan不调用模型或直接Engine.receive。原生集成会在真正输入投递后调用markDelivered，Engine Trigger本身仍幂等，不能先ack再异步丢失执行。

writer范围仅packages/business/followups/**与tests/business/followups*.test.ts，允许为导出修改business/index.ts，必要application接线由Leader完成。可在不破坏DTO的前提下拆分内部纯计算/持久化模块；接口若不足先说明，不私改共享DTO。
