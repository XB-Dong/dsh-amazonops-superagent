// Transport types adapted from ccagent (MIT); no implementation imports.

export type Base = {
  id: string;
  scope: string;
  kind: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type Source = Base & {
  kind: 'source';
  text: string;
  origin: 'user' | 'tool';
  sessionId?: string;
};

export type Limits = {
  maxCalls: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  maxTotalTokens: number | null;
};

export type Usage = { inputTokens: number; outputTokens: number };

export type BudgetPolicy = { account: string; period: 'daily' | 'lifetime' };

export type Feedback = Base & {
  amendments?: { text: string; sourceId: string; createdAt: string }[];
  text: string;
  expected: string;
  actual: string;
  page: string;
  sources: string[];
  count: number;
  status: string;
};

export type Memory = Base & {
  text: string;
  key: string;
  value: string;
  status: string;
  sources: string[];
  supersedes?: string;
};

export type Skill = Base & {
  name: string;
  description: string;
  status: string;
  risk: string;
  sources: string[];
  tools: string[];
  steps: string[];
  content: string;
  hash: string;
  validation: string[];
};

export type Task = Base & {
  title: string;
  status: string;
  checklist: string[];
  checked: boolean[];
  timeZone: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  completedAt?: string;
  actualMinutes?: number | null;
  confirmedSuccess: boolean;
  sources: string[];
};

export type TaskSchedule = {
  timeZone?: string;
  startAt?: string | null;
  endAt?: string | null;
  dueAt?: string | null;
};

export type Activity = Base & {
  title: string;
  store: string;
  listing: string;
  timeZone: string;
  startAt: string;
  endAt: string;
  leadHours: number;
  offerNote: string;
  status: string;
  sources: string[];
  stages: { name: string; dueAt: string; taskId: string }[];
};

export type Note = Base & {
  title: string;
  content: string;
};

export type ReportInput = {
  kind: 'sales' | 'ads';
  store: string;
  site: string;
  asOf: string;
  csv: string;
  mapping: Record<string, string>;
};

export type ReportBatch = Base &
  Omit<ReportInput, 'csv' | 'kind'> & {
    reportKind: 'sales' | 'ads';
    rows: Record<string, string | number>[];
    contentHash: string;
    sources: string[];
    warnings: string[];
  };

export type Forecast = Base & {
  store: string;
  site: string;
  listing: string;
  asOf: string;
  batchId?: string;
  baselineDaily: number | null;
  dailyDemand: number;
  manualReason: string;
  version: number;
  previousId?: string;
  method: string;
  sources: string[];
};

export type ForecastInput = {
  requestId?: string;
  store: string;
  site: string;
  listing: string;
  asOf: string;
  batchId?: string;
  manualDaily?: number;
  manualReason?: string;
};

export type ProjectionInput = {
  asOf: string;
  available: number;
  reserved: number;
  inbound: { date: string; quantity: number }[];
  leadDays: { purchase: number; transport: number; receiving: number };
  safetyDays: number;
  horizon: number;
  demandFactors: { date: string; multiplier: number }[];
};

export type Inventory = Base &
  ProjectionInput & {
    forecastId: string;
    physicalSku: string;
    store: string;
    site: string;
    listing: string;
    dailyDemand: number;
    projection: InventoryProjection;
    sources: string[];
  };

export type Pool = Base & {
  batchReference?: string;
  physicalSku: string;
  quantity: number;
  windows: { store: string; from: string; to: string }[];
  sources: string[];
};

export type Allocation = Base & {
  poolId: string;
  inventoryId: string;
  physicalSku: string;
  store: string;
  site: string;
  listing: string;
  quantity: number;
  shipDate: string;
  status: string;
  sources: string[];
};

export type Shipment = Base & {
  allocationId: string;
  physicalSku: string;
  store: string;
  site: string;
  listing: string;
  quantity: number;
  shipDate: string;
  destination: string;
  owner: string;
  prerequisites: boolean[];
  amazonId: string;
  erpId: string;
  received: number;
  status: string;
  sources: string[];
};

export type AdOptions = {
  groupBy: 'listing' | 'campaign' | 'adGroup' | 'searchTerm';
  attributionDays: number;
  minClicks: number;
  maxACOS: number;
  campaignFilter?: string;
  dailyBudget?: number;
  budgetCurrency?: string;
  costPerOrder?: number;
  costCurrency?: string;
  costBasisComplete?: boolean;
};

export type AdGroup = {
  name: string;
  campaign?: string;
  currency: string;
  latestDate: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  revenue: number;
  ctr: number | null;
  cpc: number | null;
  cvr: number | null;
  acos: number | null;
  roas: number | null;
  mature: boolean;
  profit: number | null;
  suggestions: string[];
  dailySpend: { date: string; spend: number }[];
};

export type AdAnalysis = Base & {
  batchId: string;
  asOf: string;
  store: string;
  site: string;
  options: AdOptions;
  groups: AdGroup[];
  sources: string[];
};

export type Snapshot = {
  adAnalyses: AdAnalysis[];
  forecasts: Forecast[];
  inventories: Inventory[];
  pools: Pool[];
  allocations: Allocation[];
  shipments: Shipment[];
  activities: Activity[];
  reminders: {
    id: string;
    revision: number;
    title: string;
    dueAt: string;
    timeZone: string;
    read: boolean;
  }[];
  reports: ReportBatch[];
  tasks: Task[];
  notes: Note[];
  feedback: Feedback[];
  memories: Memory[];
  skills: Skill[];
  sessions: Conversation[];
  jobs: { id: string; status: string; type: string }[];
  learningEnabled: boolean;
  summary: { summary: string; revision: number } | null;
};

export type Status = {
  syntheticModel?: boolean;
  modelState?: string;
  authenticated: boolean;
  live: boolean;
  scope: string;
  budget: {
    used: { calls: number; inputTokens: number; outputTokens: number };
    limits: { maxCalls: number | null; maxTotalTokens: number | null };
    policy?: { account: string; period: 'daily' | 'lifetime' };
  };
};

export type InventoryProjection = {
 days: { date: string; opening: number; arrival: number; demand: number; closing: number; lostDemand: number }[];
 stockoutDate: string | null; replenishQuantity: number; urgentGap: number; earliestArrivalDate: string;
 lastShipDate: string | null; lastPrepareDate: string | null; safetyThreshold: number; lostDemand: number; assumptions: string[];
};

export type Conversation = Base & { title: string; nativeId?: string; messages: { role: string; text: string; status?: string }[] };

export type WorkTicket = { id: string; title: string; status: string; sessionId?: string; latestReport?: { text?: string; status?: string } };

export type WorkMessage = { id: string; threadId: string; role: 'user' | 'assistant'; text: string; ticketId?: string; at: string };

export type WorkSnapshot = { tickets: WorkTicket[]; messages: WorkMessage[] };
