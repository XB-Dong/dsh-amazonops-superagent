import type { Store } from './core/store.ts';
import type { Learning } from './learning/service.ts';
import type { Capture } from './learning/capture.ts';
import type { Tasks } from './operations/tasks.ts';
import type { Notes } from './operations/notes.ts';
import type { Activities } from './operations/activities.ts';
import type { Reports } from './operations/reports.ts';

export type Input = Record<string, unknown>;
export interface CommandContext {
  store: Store; learning: Learning; capture: Capture; tasks: Tasks;
  notes: Notes; activities: Activities; reports: Reports; dataDir: string;
}
export type CommandHandler = (context: CommandContext, scope: string, input: Input) => unknown;
export type CommandMap = Record<string, CommandHandler>;
