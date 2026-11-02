import assert from 'node:assert/strict';
import test from 'node:test';
import { csvCell } from '../../packages/client/csv.ts';
test('client exports preserve literal CSV values and neutralize string formulas', () => {
  assert.equal(csvCell(' x,"y"'), '" x,""y"""');
  assert.equal(csvCell('  =1+1'), '"\'  =1+1"');
  assert.equal(csvCell(-12.5), '"-12.5"');
  assert.equal(csvCell('@sum'), '"\'@sum"');
});
