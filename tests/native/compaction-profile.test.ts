import test from 'node:test';
import { nativeCompaction } from './compaction-fixture.ts';

test('production 8192-token profile automatically compacts native history with durable usage and restart replay',
  { timeout: 150000 }, t => nativeCompaction(t, true));
