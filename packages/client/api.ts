import type { Snapshot, Status } from '../contracts/model.ts';
export type { Snapshot, Status } from '../contracts/model.ts';
export function modelLabel(status?: Status) {
  if (!status) return '正在确认助手状态';
  if (status.syntheticModel) return '示例体验';
  const labels: Record<string, string> = {
    disabled: '助手暂未开放',
    maintenance: '助手正在更新，请稍后',
    budget_exhausted:
      status.budget.policy?.period === 'daily'
        ? '今日使用已达上限，明天可继续'
        : '助手暂时无法回复',
    last_failed: '上次回复未完成，可重试',
    last_succeeded: '可以和助手聊聊',
    enabled_unverified: '可以开始对话',
  };
  return labels[status.modelState ?? ''] ?? (status.live ? '可以开始对话' : '助手暂未开放');
}
export const canChat = (status?: Status) =>
  !!status?.live && !['disabled', 'budget_exhausted','maintenance'].includes(status.modelState ?? '');
export const assistantHealthy = (status?: Status) =>
  canChat(status) && status?.modelState !== 'last_failed' && !status?.syntheticModel;
const errorLabels: Record<string, string> = {
  AUTH_REQUIRED: '请先登录工作台',
  MAINTENANCE_IN_PROGRESS:'助手正在更新，请稍后再试；已保存的记录不会丢失。',
  LOGIN_FAILED: '密码不正确，请重试',
  LOGIN_RATE_LIMITED: '尝试次数较多，请稍后再登录',
  TIME_ZONE_REQUIRED: '请先填写站点时区',
  INVALID_TIME_ZONE: '请选择有效的站点时区',
  EXPLICIT_OFFSET_REQUIRED: '请填写完整的站点时间，格式可参考输入框中的示例',
  CHECKLIST_INCOMPLETE: '先完成清单中的检查项，再确认成功',
  REVISION_CONFLICT: '这条记录刚刚更新，请刷新后重试',
  STALE_TICKET: '这件工作刚刚更新，原草稿已保留。请取消编辑后重新打开，再按最新进度提交。',
  STALE_ATTENTION: '这个问题已经更新或结束，原答复已保留。请查看当前问题后重新回答。',
  NOT_RETRYABLE: '这件工作当前不需要重试，请查看最新进度。',
  TICKET_ENDED: '这件工作已结束，不能继续提交。需要新工作时请开始新对话。',
  REQUEST_CONFLICT: '这次请求的内容已经变化，请取消原编辑后重新提交。',
  INVALID_WATCH: '请明确选择现有库存方案，并填写有效的跟进结束时间。',
  WATCH_EXPIRED: '这项跟进已经到期，请按需要建立新的有限期跟进。',
  WATCH_STOPPED: '这项跟进已经停止，后续变化不会再继续执行。',
  AUTO_NOT_AVAILABLE: '自动复核尚未通过启用检查，可以先保存为观察模式。',
  AUTO_GATE_REQUIRED: '自动复核尚未通过启用检查，可以先使用观察模式。',
  SENSITIVE_INPUT_BLOCKED: '内容包含疑似凭据，请移除后再保存',
  MODEL_BUDGET_EXHAUSTED:
    '本次使用已达保护上限，任务和反馈仍可保存。日常使用上限会在北京时间零点恢复。',
  MODEL_TURN_LIMIT: '这次处理的步骤较多，请拆成更小的任务再试。',
  CHAT_REQUEST_ALREADY_ACCEPTED: '上一条消息正在处理，请稍等后查看最近对话。',
  NOT_FOUND: '这条记录已不存在，请刷新页面；对话可点“新对话”重新开始。',
  MODEL_OFFLINE: '助手暂未开放，请先使用左侧功能记录工作。',
  CHAT_FAILED: '消息未能发送，请稍后重试。',
  ORIGIN_FORBIDDEN: '页面连接已失效，请重新打开工作台后再试。',
  REPORT_TOO_LARGE: '报表较大，请拆分为较小的文件后导入。',
  INVALID_REPORT_SIZE: '请导入含标题和数据的报表，每份最多1000行数据。',
  SESSION_BUSY: '助手仍在处理上一条消息',
  EXPORT_REDACTION_REQUIRED: '导出内容需要先移除敏感信息',
  SKILL_REVOKED_OR_UNAVAILABLE: '这条经验已停用或不再适用',
  COPY_REQUEST_CONFLICT: '复制内容已改变，请关闭复制窗口后重新打开。',
  INVALID_COPY: '请核对复制内容；原标识和新标识需要同时填写或同时留空。',
  DERIVATION_REVOKED: '原任务或来源已删除，请刷新后重新选择任务。',
  INVALID_TASK: '请填写任务标题和至少一个检查项',
  INVALID_CHECKLIST: '请核对检查清单，每一项都需要填写内容',
  TASK_NOT_EDITABLE: '完成或取消的任务保留原流程，请新建任务；已完成任务仍可修正实际用时',
  INVALID_ACTUAL_MINUTES: '实际用时请填写 0 到 1440 之间的整数分钟，也可以留空',
  INVALID_TIME_RANGE: '结束时间需要晚于开始时间',
  TASK_TIME_ORDER: '结束时间需要晚于开始时间，请检查日期和时间',
  TIME_ZONE_SCHEDULE_REQUIRED: '修改时区后，请重新选择计划时间，或清除原计划时间',
  TASK_END_DUE_MISMATCH: '计划结束时间不一致，请重新选择结束日期和时间',
  INVALID_TIME: '日期或时间无效，请重新选择',
  INVALID_TEXT: '请填写有效内容，并检查是否超过页面提示的字数限制',
  INVALID_NOTE: '请填写笔记标题和正文，标题最多 200 字，正文最多 10000 字',
  SITE_TIME_MISMATCH: '时间偏移与站点时区不一致，请检查夏令时及当地时间',
  INVALID_ACTIVITY: '请检查活动起止时间、店铺和链接',
  MISSING_VALUE: '报表包含缺失值，请补齐，缺失不会按零处理',
  DUPLICATE_ROW: '报表含重复记录，请先核对',
  MISSING_COLUMN: '请核对每项对应的报表列名，必填项不能留空，也不能重复。',
  INVALID_CSV: 'CSV格式不正确，请检查引号及每行列数',
  INVALID_DATE: '日期无效，请按“年-月-日”填写，例如 2026-10-26',
  INVALID_NUMBER: '数量或金额无效，请检查负数和小数',
  INSUFFICIENT_SALES: '缺少截至日期连续7日销量，请补齐或明确填写人工日需求及原因',
  MANUAL_REASON_REQUIRED: '人工修正需填写原因，原始基线会保留',
  POOL_EXHAUSTED: '共享库存不足，已有分配不会重复计算',
  STORE_WINDOW_CLOSED: '发货日期不在该店铺可用时段',
  POOL_SKU_MISMATCH: '共享库存与库存方案的实物商品编码不一致',
  PREREQUISITES_REQUIRED: '请完成四项前置检查，并填写目的仓与负责人',
  DUAL_IDS_REQUIRED: '请先填写亚马逊及公司系统的两个单号',
  DUPLICATE_EXTERNAL_ID: '该系统单号已经关联另一发货记录',
  INVALID_RECEIPT: '累计到货不可倒退、超量或在发运前登记',
  PAST_INBOUND: '在途日期早于库存快照，请核实延误或实际到货',
  BUDGET_SCOPE_REQUIRED: '预算比较需选择广告活动分组，并明确一个活动名称',
  MISSING_AD_GROUP: '当前报表缺少广告组，请填写“广告组”对应的列名后重新导入。',
  MONEY_PRECISION_OR_RANGE: '金额超出支持精度或范围，最多6位小数，请核对数据',
  BUDGET_CURRENCY_REQUIRED: '请明确填写每日预算的币种',
  INVALID_CURRENCY: '币种请使用三个大写字母，例如USD',
};
export const errorMessage = (value: string) =>
  errorLabels[value] ?? '操作暂未完成，请核对填写内容后重试；仍不成功请联系工作台维护者。';
export async function api<T>(path: string, body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/amazonops/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('连接不上工作台，请检查网络后重试。');
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error('工作台暂时没有正常响应，请稍后重试。');
  }
  if (!response.ok) throw new Error(errorMessage(value.error ?? 'REQUEST_FAILED'));
  return value as T;
}
export const requestId = () => crypto.randomUUID();
export function download(name: string, content: string, type = 'text/markdown') {
  const url = URL.createObjectURL(
    new Blob([type.startsWith('text/csv') ? '\uFEFF' + content : content], { type }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const empty: Snapshot = {
  adAnalyses: [],
  forecasts: [],
  inventories: [],
  pools: [],
  allocations: [],
  shipments: [],
  activities: [],
  reminders: [],
  reports: [],
  tasks: [],
  notes: [],
  feedback: [],
  memories: [],
  skills: [],
  sessions: [],
  jobs: [],
  learningEnabled: true,
  summary: null,
};
