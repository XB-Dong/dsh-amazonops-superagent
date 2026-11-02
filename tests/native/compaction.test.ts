import test from 'node:test';
import { nativeCompaction } from './compaction-fixture.ts';

test('offline native worker compacts persisted history through CompactionEngine and replays checkpoint after restart',
  { timeout: 150000 }, t => nativeCompaction(t));
