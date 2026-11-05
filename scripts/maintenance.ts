/** Read-only maintenance inspection. This never starts development, models or a scheduler. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeMaintenance, checkMaintenance } from '../packages/business/maintenance/index.ts';

export function maintenanceCli(args: string[]) {
  const [command, ...rest] = args;
  if (!['init', 'check'].includes(command) || rest.length % 2) throw new Error('MAINTENANCE_ARGUMENTS_INVALID');
  const input: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!['--data', '--registry', '--authority', '--owner', '--destination', '--state', '--mode', '--output'].includes(key) ||
      input[key] !== undefined || !rest[i + 1]) throw new Error('MAINTENANCE_ARGUMENTS_INVALID');
    input[key] = rest[i + 1];
  }
  for (const key of ['--data', '--registry', '--authority', '--owner', ...(command === 'init' ? ['--destination'] : ['--state', '--mode', '--output'])])
    if (!input[key]) throw new Error('MAINTENANCE_ARGUMENTS_INVALID');
  const options = { data: input['--data'], registry: input['--registry'], authority: input['--authority'], owner: input['--owner'] };
  if (command === 'init') return initializeMaintenance({ ...options, destination: input['--destination'] });
  const report = checkMaintenance({ ...options, state: input['--state'], mode: input['--mode'], output: input['--output'] });
  return { ok: true, mode: report.mode, actionable: report.actionable, sourceStable: report.sourceStable,
    feedbackChanges: report.changes.feedback.added.length + report.changes.feedback.changed.length + report.changes.feedback.removed.length,
    pendingCaptureChanges: report.changes.pendingCapture.added.length + report.changes.pendingCapture.changed.length + report.changes.pendingCapture.removed.length,
    deletionChanges: report.changes.tombstones.added.length + report.changes.tombstones.changed.length + report.changes.tombstones.removed.length,
    registryChanged: report.registryChanged, privacyChanged: report.privacyChanged,
    pendingCaptureOutstanding: report.pendingCaptureOutstanding,
    legacyHistoryCount: report.legacyHistoryCount, canDevelop: false, modelCalls: 0, newWaves: 0 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(maintenanceCli(process.argv.slice(2)))}\n`); }
  catch (error) {
    const message = error instanceof Error && /^MAINTENANCE_[A-Z_]+$/.test(error.message) ? error.message : 'MAINTENANCE_OPERATION_FAILED';
    process.stderr.write(`${message}\n`); process.exitCode = 1;
  }
}
