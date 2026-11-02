import { join } from 'node:path';
import { Store } from './core/store.ts';
import { Learning } from './learning/service.ts';
import { Capture } from './learning/capture.ts';
import { Tasks } from './operations/tasks.ts';
import { Notes } from './operations/notes.ts';
import { Activities } from './operations/activities.ts';
import { Reports } from './operations/reports.ts';
import { taskCommands } from './commands-tasks.ts';
import { noteCommands } from './commands-notes.ts';
import { activityCommands } from './commands-activities.ts';
import { analysisCommands } from './commands-analysis.ts';
import { learningCommands } from './commands-learning.ts';
import { businessTool } from './tools.ts';
import type { CommandContext, Input } from './command-context.ts';
import { safeText } from './core/validation.ts';
import { businessSnapshot, type BusinessSnapshot } from './query.ts';

const handlers = Object.freeze({ ...taskCommands, ...noteCommands, ...activityCommands,
  ...analysisCommands, ...learningCommands });

export class Business implements CommandContext {
  store: Store;
  dataDir: string;
  learning: Learning;
  capture: Capture;
  tasks: Tasks;
  activities: Activities;
  reports: Reports;
  notes: Notes;
  private listeners = new Set<(scope: string) => void>();

  constructor(dataDir: string | Store, legacyDataDir?: string) {
    this.dataDir = typeof dataDir === 'string' ? dataDir : legacyDataDir!;
    this.store = typeof dataDir === 'string' ? new Store(join(dataDir, 'business.sqlite')) : dataDir;
    this.learning = new Learning(this.store);
    this.capture = new Capture(this.store, this.learning);
    this.tasks = new Tasks(this.store);
    this.activities = new Activities(this.store);
    this.reports = new Reports(this.store);
    this.notes = new Notes(this.store);
  }
  snapshot(scope: string): BusinessSnapshot {
    return businessSnapshot(this.store, scope, this.learning.enabled(scope));
  }
  command(scope: string, action: string, input: Input): unknown {
    if (!Object.hasOwn(handlers, action)) throw new Error('NOT_FOUND');
    const execute = () => {
      const result = handlers[action](this, scope, input);
      this.store.appendEvent(scope, `business:${action}`, result && typeof result === 'object' ? result : undefined);
      return result;
    };
    let value: unknown;
    try {
      value = input.requestId === undefined ? this.store.transaction(execute) : this.store.command(
        scope, `${action}:${safeText(input.requestId, 100)}`, input, execute,
      );
    } catch (error) {
      if (action === 'task-copy' && error instanceof Error && error.message === 'REQUEST_CONFLICT')
        throw new Error('COPY_REQUEST_CONFLICT');
      throw error;
    }
    this.changed(scope);
    return value;
  }
  // Compatibility for migrated behavior tests; application entrypoints use command.
  mutate(scope: string, action: string, input: Input): unknown { return this.command(scope, action, input); }
  tool(scope: string, sourceId: string | undefined, action: string, input: Input, operationId?: string): unknown {
    const value = businessTool(this, scope, sourceId, action, input, operationId);
    if (['copy_task', 'prepare_task', 'capture_feedback'].includes(action)) this.changed(scope);
    return value;
  }
  tick(scope: string): void {
    const before = this.store.db.prepare('SELECT total_changes() AS n').get()?.n;
    this.capture.drain(scope);
    this.learning.drainWorkflows(scope);
    this.activities.tick(scope);
    if (this.store.db.prepare('SELECT total_changes() AS n').get()?.n !== before) this.changed(scope);
  }
  onChange(listener: (scope: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(scope: string): void {
    // Observers invalidate projections after commit; they cannot roll back committed business work.
    for (const listener of this.listeners) { try { listener(scope); } catch {} }
  }
  close(): void { this.store.close(); }
}
