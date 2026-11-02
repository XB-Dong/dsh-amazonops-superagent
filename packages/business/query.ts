import { Store, type Base } from './core/store.ts';
import type { Task } from './operations/task-types.ts';
import type { Note } from './operations/note-types.ts';
import type { Activity } from './operations/activities.ts';
import type { ReportBatch } from './operations/reports.ts';
import type { Forecast } from './operations/forecast.ts';
import type { Inventory } from './operations/inventory.ts';
import type { Pool, Allocation } from './operations/allocation.ts';
import type { Shipment } from './operations/shipping.ts';
import type { AdAnalysis } from './operations/advertising.ts';
import type { Feedback, Memory, Skill } from './learning/service.ts';

export type Reminder = Base & {
  title: string; dueAt: string; timeZone: string; read: boolean;
  activityId: string; taskId: string; sources: string[];
};
export type Job = Base & { status: string; type: string; attempts: number; sourceId?: string; taskId?: string };
export type Summary = Base & { summary: string; factHash: string; sourceIds: string[]; factIds: string[] };
export type BusinessSnapshot = {
  forecasts: Forecast[]; inventories: Inventory[]; pools: Pool[]; allocations: Allocation[];
  shipments: Shipment[]; adAnalyses: AdAnalysis[]; activities: Activity[]; reminders: Reminder[];
  reports: ReportBatch[]; tasks: Task[]; notes: Note[]; feedback: Feedback[]; memories: Memory[];
  skills: Skill[]; jobs: Job[]; sessions: never[]; learningEnabled: boolean; summary: Summary | null;
};

export function businessSnapshot(store: Store, scope: string, learningEnabled: boolean): BusinessSnapshot {
  return {
    forecasts: store.list(scope, 'forecast'), inventories: store.list(scope, 'inventory'), pools: store.list(scope, 'pool'),
    allocations: store.list(scope, 'allocation'), shipments: store.list(scope, 'shipment'), adAnalyses: store.list(scope, 'adAnalysis'),
    activities: store.list(scope, 'activity'), reminders: store.list(scope, 'reminder'), reports: store.list(scope, 'report'),
    tasks: store.list(scope, 'task'), notes: store.list(scope, 'note'), feedback: store.list(scope, 'feedback'),
    memories: store.list(scope, 'memory'), skills: store.list(scope, 'skill'), jobs: store.list(scope, 'job'),
    sessions: [], learningEnabled, summary: store.list<Summary>(scope, 'summary')[0] ?? null,
  };
}
