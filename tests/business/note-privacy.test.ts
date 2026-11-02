import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Store } from '../../packages/business/core/store.ts';

test('manual-note deletion is replayed without retiring unrelated conversations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-note-privacy-'));
  const path = join(dir, 'business.sqlite');
  let store = new Store(path);
  try {
    const conversation = store.create('main', 'conversation', {
      title: 'Unrelated synthetic chat',
    });
    const summary = store.create('main', 'summary', { summary: 'Unrelated confirmed facts' });
    const note = store.create('main', 'note', { title: 'Synthetic note', content: 'Private note' });
    store.close();
    const restore = join(dir, 'restore');
    mkdirSync(restore);
    copyFileSync(path, join(restore, 'business.sqlite'));
    store = new Store(path);
    store.remove('main', note.id, 'delete-note');
    assert.throws(() => store.get('main', note.id), /NOT_FOUND/);
    assert.equal(store.get('main', conversation.id).id, conversation.id);
    assert.equal(store.get('main', summary.id).id, summary.id);
    copyFileSync(join(dir, 'privacy-ledger.jsonl'), join(restore, 'privacy-ledger.jsonl'));
    const restored = new Store(join(restore, 'business.sqlite'));
    try {
      assert.throws(() => restored.get('main', note.id), /NOT_FOUND/);
      assert.equal(restored.get('main', conversation.id).id, conversation.id);
      assert.equal(restored.get('main', summary.id).id, summary.id);
    } finally {
      restored.close();
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('old privacy readers cannot poison the application marker for a manual-note erasure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-note-old-reader-'));
  const store = new Store(join(dir, 'business.sqlite'));
  try {
    const note = store.create('main', 'note', {
      title: 'Synthetic note',
      content: 'Must remain erased',
    });
    store.privacyIntent('main', note.id, 'delete-note');
    const line = readFileSync(store.ledgerPath, 'utf-8').trim();
    const oldId = createHash('sha256').update(`closure-v2:${line}`).digest('hex');
    // Pre-P4.1 readers marked unknown actions applied even though they did not erase them.
    store.db.prepare('INSERT INTO privacy_applied VALUES (?)').run(oldId);
    store.applyPrivacyLedger();
    assert.throws(() => store.get('main', note.id), /NOT_FOUND/);
    assert.equal(store.isDeleted('main', note.id), true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
