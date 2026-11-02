import type { Task } from '../operations/task-types.ts';
export type { Task } from '../operations/task-types.ts';
import { Store, digest, type Base } from '../core/store.ts';

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

export class Learning {
  store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  enabled(scope: string): boolean {
    return this.store.list<Base & { enabled: boolean }>(scope, 'settings')[0]?.enabled !== false;
  }
  setEnabled(scope: string, enabled: boolean): void {
    const old = this.store.list<Base & { enabled: boolean }>(scope, 'settings')[0];
    if (old) this.store.update(old, { enabled });
    else this.store.create(scope, 'settings', { enabled });
  }
  feedback(
    scope: string,
    sourceId: string,
    data: { text: string; page?: string; expected?: string; actual?: string },
  ): Feedback | undefined {
    if (!this.enabled(scope)) return;
    this.store.get(scope, sourceId);
    const normalized = data.text.trim().replace(/\s+/g, ' ');
    if (!normalized) throw new Error('INVALID_FEEDBACK');
    return this.store.once(scope, `feedback:${sourceId}`, () => {
      const old = this.store
        .list<Feedback>(scope, 'feedback')
        .find(
          (item) =>
            item.text === normalized &&
            item.page === (data.page ?? 'assistant') &&
            item.expected === (data.expected ?? '') &&
            item.actual === (data.actual ?? '') &&
            item.status !== 'withdrawn',
        );
      if (old)
        return this.store.update(old, {
          sources: [...old.sources, sourceId],
          count: old.count + 1,
        });
      return this.store.create(scope, 'feedback', {
        text: normalized,
        page: data.page ?? 'assistant',
        expected: data.expected ?? '',
        actual: data.actual ?? '',
        sources: [sourceId],
        count: 1,
        status: 'captured',
      }) as Feedback;
    });
  }
  remember(
    scope: string,
    sourceId: string,
    key: string,
    value: string,
    confirmed: boolean,
  ): Memory | undefined {
    if (!this.enabled(scope)) return;
    this.store.get(scope, sourceId);
    return this.store.once(scope, `memory:${sourceId}:${key}`, () => {
      const old = this.store
        .list<Memory>(scope, 'memory')
        .find((row) => row.key === key && row.status === 'confirmed');
      if (old && confirmed) this.store.update(old, { status: 'superseded' });
      return this.store.create(scope, 'memory', {
        key,
        value,
        text: `${key}：${value}`,
        sources: [sourceId],
        status: confirmed ? 'confirmed' : 'inferred',
        supersedes: confirmed ? old?.id : undefined,
      }) as Memory;
    });
  }
  context(scope: string): { facts: Memory[]; summary: string } {
    const facts = this.store
      .list<Memory>(scope, 'memory')
      .filter(
        (row) =>
          row.status === 'confirmed' && row.sources.every((id) => !this.store.isDeleted(scope, id)),
      );
    return { facts, summary: facts.map((row) => `${row.text} [${row.id}]`).join('\n') };
  }
  compact(scope: string, expectedRevision?: number): Base {
    const previous = this.store.list<
      Base & { summary: string; sourceIds: string[]; factHash: string }
    >(scope, 'summary')[0];
    const facts = this.context(scope).facts;
    const data = {
      summary: facts
        .map((row) => row.text)
        .join('；')
        .slice(0, 1200),
      sourceIds: facts.flatMap((row) => row.sources),
      factHash: digest(facts),
      factIds: facts.map((row) => row.id),
    };
    // Structured facts stay authoritative; this bounded display is rebuildable.
    if (previous) return this.store.update(previous, data, expectedRevision ?? previous.revision);
    if (expectedRevision !== undefined && expectedRevision !== 0)
      throw new Error('REVISION_CONFLICT');
    return this.store.create(scope, 'summary', data);
  }
  deriveSkill(scope: string, taskId: string, risk = 'L0'): Skill | undefined {
    if (!this.enabled(scope)) return;
    const task = this.store.get<Task>(scope, taskId);
    if (
      task.kind !== 'task' ||
      !task.confirmedSuccess ||
      task.status !== 'done' ||
      !task.checked.every(Boolean) ||
      !task.checklist.length
    )
      throw new Error('WORKFLOW_NOT_CONFIRMED_SUCCESS');
    if (!['L0', 'L1'].includes(risk)) throw new Error('EXTERNAL_SKILL_FORBIDDEN');
    return this.store.once(scope, `skill:${taskId}:${risk}`, () => {
      const steps = [...task.checklist];
      const content = `# ${task.title}\n\n适用范围：${scope}\n\n前提：人工检查当前店铺与时间。\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n\n检查：逐项确认，缺失信息询问 cc。失败时停止并报告，不操作外部平台。`;
      const validation = this.validateDraft(steps);
      if (Buffer.byteLength(content) > 5000) validation.push('SKILL_CONTEXT_TOO_LARGE');
      return this.store.create(scope, 'skill', {
        name: `cc-workflow-${digest(taskId).slice(0, 12)}`,
        description: task.title,
        status: risk === 'L0' && validation.length === 0 ? 'active' : 'waiting_confirmation',
        risk,
        sources: [taskId, ...task.sources],
        tools: ['cc_list_tasks', 'cc_draft_checklist'],
        steps,
        content,
        hash: digest(content),
        validation,
      }) as Skill;
    });
  }
  drainWorkflows(scope: string): void {
    if (!this.enabled(scope)) return;
    const jobs = this.store.list<Base & { type: string; status: string; taskId: string; attempts: number }>(scope, 'job');
    for (const job of jobs.filter(row => row.type === 'workflow' && row.status === 'pending')) {
      try {
        this.deriveSkill(scope, job.taskId);
        this.store.update(job, { status: 'completed', attempts: job.attempts + 1 });
      } catch {
        this.store.update(job, { status: this.store.isDeleted(scope, job.taskId) ? 'cancelled' : 'failed', attempts: job.attempts + 1 });
      }
    }
  }
  validateDraft(steps: string[]): string[] {
    const errors: string[] = [];
    if (Buffer.byteLength(JSON.stringify(steps)) > 4000) errors.push('SKILL_CONTEXT_TOO_LARGE');
    if (
      steps.length < 1 ||
      steps.length > 30 ||
      steps.some((step) => !step.trim() || step.length > 300)
    )
      errors.push('INVALID_STEPS');
    if (
      steps.some((step) =>
        /(?:sk-[a-z\d]{12}|password|api.?key|ignore.*instructions|执行.*代码|运行.*命令)/i.test(
          step,
        ),
      )
    )
      errors.push('UNSAFE_CONTENT');
    // Dry-run the only permitted L0 operation: draft a checklist without business writes.
    const dryRun = steps.map((text) => ({ text, checked: false }));
    if (dryRun.length !== steps.length || dryRun.some((row) => row.checked))
      errors.push('DRAFT_REPLAY_FAILED');
    return errors;
  }
  activeSkills(scope: string): Skill[] {
    return this.store
      .list<Skill>(scope, 'skill')
      .filter(
        (skill) =>
          skill.status === 'active' &&
          skill.hash === digest(skill.content) &&
          skill.sources.every((id) => !this.store.isDeleted(scope, id)) &&
          this.validateDraft(skill.steps).length === 0,
      );
  }
  revoke(scope: string, id: string): Skill {
    const skill = this.store.get<Skill>(scope, id);
    if (skill.kind !== 'skill') throw new Error('INVALID_SKILL');
    this.store.privacyIntent(scope, id, 'revoke');
    return this.store.update(skill, { status: 'revoked' });
  }
  deleteSource(scope: string, id: string): void {
    this.store.transaction(() => {
      const record = this.store.get<Base & { sources?: string[] }>(scope, id);
      if (['memory', 'feedback'].includes(record.kind))
        for (const sourceId of record.sources ?? []) {
          const source = this.store.get<Base>(scope, sourceId);
          if (source.kind === 'source') this.store.remove(scope, sourceId);
        }
      this.store.remove(scope, id);
      this.store.applyPrivacyLedger();
    });
  }
}
