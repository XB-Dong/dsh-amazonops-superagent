import type { Base } from '../core/store.ts';

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
