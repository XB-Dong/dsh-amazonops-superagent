import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/business/core/store.ts';
import { Business } from '../../packages/business/index.ts';
test('operation summaries disclose omitted records and preserve campaign ownership', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-ops-context-'));
  const store = new Store(join(dir, 'business.sqlite'));
  const business = new Business(store, dir);
  try {
    for (let i = 0; i < 3; i++)
      store.create('a', 'adAnalysis', {
        store: 'S',
        asOf: '2026-10-25',
        batchId: 'synthetic',
        options: { attributionDays: 7, costBasisComplete: false },
        groups: [
          {
            name: 'Default',
            campaign: `C${i}`,
            currency: 'USD',
            profit: null,
            acos: null,
            roas: null,
            mature: false,
          },
        ],
      });
    const result = business.tool('a', undefined, 'read_operations', {}) as any;
    assert.equal(result.totals.adAnalysis, 3);
    assert.equal(result.truncated, true);
    assert.equal(result.advertising[0].groups[0].campaign, 'C2');
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 5000);
    assert.equal(
      (business.tool('b', undefined, 'read_operations', {}) as any).totals.adAnalysis,
      0,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('growing task and memory stores yield bounded, paged model projections without losing facts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-context-'));
  const store = new Store(join(dir, 'business.sqlite'));
  const business = new Business(store, dir);
  try {
    for (let index = 0; index < 45; index++) {
      const source = store.source('a', `合成来源 ${index}`);
      store.create('a', 'task', {
        title: '库存检查'.repeat(40),
        status: 'open',
        timeZone: 'Asia/Shanghai',
        checklist: Array(30).fill('检查'.repeat(100)),
        checked: [],
        sources: [source.id],
      });
      business.learning.remember('a', source.id, `事实${index}`, '精确数据'.repeat(60), true);
    }
    const first = business.tool('a', undefined, 'list_tasks', {}) as {
      tasks: { id: string }[];
      nextOffset: number;
    };
    assert.equal(first.tasks.length, 8);
    assert.ok(Buffer.byteLength(JSON.stringify(first)) < 6000);
    const second = business.tool('a', undefined, 'list_tasks', {
      offset: first.nextOffset,
    }) as typeof first;
    assert.notEqual(first.tasks[0].id, second.tasks[0].id);
    const memory = business.tool('a', undefined, 'read_memory', {}) as { facts: unknown[] };
    assert.equal(memory.facts.length, 4);
    assert.ok(Buffer.byteLength(JSON.stringify(memory)) < 6000);
    assert.equal(store.list('a', 'memory').length, 45);
    for (let index = 0; index < 8; index++) {
      const source = store.source('a', `Skill source ${index}`);
      const task = store.create('a', 'task', {
        title: `Workflow ${index}`,
        status: 'done',
        timeZone: 'Asia/Shanghai',
        checklist: ['核对'],
        checked: [true],
        confirmedSuccess: true,
        sources: [source.id],
      });
      business.learning.deriveSkill('a', task.id);
    }
    const found = business.tool('a', undefined, 'find_skills', { query: 'Workflow 0' }) as {
      skills: { description: string }[];
    };
    assert.equal(found.skills[0].description, 'Workflow 0');
    assert.deepEqual(business.tool('b', undefined, 'list_tasks', {}), {
      tasks: [],
      nextOffset: null,
      total: 0,
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
