import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type Limits = {
  maxCalls: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  maxTotalTokens: number | null;
};
export function parseBudgetLimit(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (value === 'unlimited') return null;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('INVALID_MODEL_BUDGET');
  return Number(value);
}
export type Usage = { inputTokens: number; outputTokens: number };
export type BudgetPolicy = { account: string; period: 'daily' | 'lifetime' };

export function ensureBudgetSchema(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS model_requests (
    id TEXT PRIMARY KEY, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    settled INTEGER NOT NULL DEFAULT 0, usage_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, budget_account TEXT NOT NULL DEFAULT 'legacy'
  );`);
    if (
      !db
        .prepare('PRAGMA table_info(model_requests)')
        .all()
        .some((row) => row.name === 'budget_account')
    )
      db.exec(
        "ALTER TABLE model_requests ADD COLUMN budget_account TEXT NOT NULL DEFAULT 'legacy'",
      );
    db.exec(
      'CREATE INDEX IF NOT EXISTS model_requests_by_account ON model_requests(budget_account)',
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export class ModelBudget {
  db: DatabaseSync;
  limits: Limits;
  policy: BudgetPolicy;
  now: () => number;
  constructor(
    path: string,
    limits: Limits,
    policy: BudgetPolicy = { account: 'legacy', period: 'lifetime' },
    now = Date.now,
  ) {
    if (
      Object.values(limits).some(
        (value) => value !== null && (!Number.isSafeInteger(value) || value <= 0),
      )
    ) {
      throw new Error('INVALID_MODEL_BUDGET');
    }
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(policy.account) ||
      !['daily', 'lifetime'].includes(policy.period)
    )
      throw new Error('INVALID_BUDGET_POLICY');
    this.db = new DatabaseSync(path);
    this.limits = limits;
    this.policy = { ...policy };
    this.now = now;
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    ensureBudgetSchema(this.db);
  }
  account(): string {
    return this.policy.period === 'daily'
      ? `${this.policy.account}@${new Date(this.now() + 8 * 3600000).toISOString().slice(0, 10)}`
      : this.policy.account;
  }
  reserve(inputTokens: number, outputTokens: number): string {
    if (
      ![inputTokens, outputTokens].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      outputTokens === 0
    ) {
      throw new Error('INVALID_TOKEN_RESERVATION');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const account = this.account();
      const used = this.readSnapshot(account);
      if (
        (this.limits.maxCalls !== null && used.calls + 1 > this.limits.maxCalls) ||
        (this.limits.maxInputTokens !== null &&
          used.inputTokens + inputTokens > this.limits.maxInputTokens) ||
        (this.limits.maxOutputTokens !== null &&
          used.outputTokens + outputTokens > this.limits.maxOutputTokens) ||
        (this.limits.maxTotalTokens !== null &&
          used.inputTokens + used.outputTokens + inputTokens + outputTokens >
            this.limits.maxTotalTokens)
      ) {
        throw new Error('MODEL_BUDGET_EXHAUSTED');
      }
      const id = randomUUID();
      this.db
        .prepare(
          'INSERT INTO model_requests (id,input_tokens,output_tokens,budget_account) VALUES (?,?,?,?)',
        )
        .run(id, inputTokens, outputTokens, account);
      this.db.exec('COMMIT');
      return id;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  settle(id: string, usage?: Usage): void {
    if (
      usage &&
      !Object.values(usage).every((value) => Number.isSafeInteger(value) && value >= 0)
    ) {
      throw new Error('INVALID_MODEL_USAGE');
    }
    if (usage) {
      this.db
        .prepare(
          'UPDATE model_requests SET input_tokens=?,output_tokens=?,settled=1,usage_verified=1 WHERE id=? AND settled=0',
        )
        .run(usage.inputTokens, usage.outputTokens, id);
    } else {
      // A failed or interrupted request might still have been billed.
      this.db.prepare('UPDATE model_requests SET settled=1 WHERE id=? AND settled=0').run(id);
    }
  }
  snapshot(): Usage & { calls: number } {
    return this.readSnapshot(this.account());
  }
  lifetimeSnapshot(): Usage & { calls: number } {
    return this.readSnapshot();
  }
  exhausted(): boolean {
    const used = this.snapshot();
    return (
      (this.limits.maxCalls !== null && used.calls >= this.limits.maxCalls) ||
      (this.limits.maxInputTokens !== null && used.inputTokens >= this.limits.maxInputTokens) ||
      (this.limits.maxOutputTokens !== null && used.outputTokens >= this.limits.maxOutputTokens) ||
      (this.limits.maxTotalTokens !== null &&
        used.inputTokens + used.outputTokens >= this.limits.maxTotalTokens)
    );
  }
  private readSnapshot(account?: string): Usage & { calls: number } {
    const query =
      'SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens FROM model_requests';
    return {
      ...(account === undefined
        ? this.db.prepare(query).get()
        : this.db.prepare(query + ' WHERE budget_account=?').get(account)),
    } as Usage & { calls: number };
  }
  close(): void {
    this.db.close();
  }
}
