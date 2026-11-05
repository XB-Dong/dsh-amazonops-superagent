import { readFileSync } from 'node:fs';
import { canonical, hash, noLinks, outputPath, readJson, writeNew,physical,within } from './files.ts';
import { inspectData, type InspectionSnapshot, type Item } from './snapshot.ts';

const PROJECT = 'dsh-amazonops-superagent';
type Mode = 'handover_validation' | 'daily';
type Options = { data: string; registry: string; authority: string; owner: string; now?: () => Date };
type Decision = { id: string; revision?: number; decision?: string; [key:string]:unknown };
type State = { schemaVersion: 'amazonops-maintenance/2'; project: typeof PROJECT; scope: 'main'; initializedAt: string;
  sourceIdentity: string; registrySha256: string; legacyDecisions: Decision[]; legacyRegistry:Record<string,unknown>;
  checkpointRoot:string;checkpointSourceIdentity:string;snapshot:InspectionSnapshot;initializedSnapshot:InspectionSnapshot };
// These are recorded historical dispositions, not grants to start new development.
const reviewedDecisions=new Set(['accepted_delivered','delivered','duplicate_assistant_question_excluded','duplicate_excluded',
  'implemented_source_deleted_excluded','withdrawn_excluded','partially_delivered_personal_ordering_pending']);
function authority(options: Options, mode: Mode): Date {
  const now = options.now?.() ?? new Date();
  const value = readJson(options.authority, 'MAINTENANCE_AUTHORITY_INVALID');
  const expiry = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
  if (value.project !== PROJECT || value.productionActive !== true || value.legacyMaintenanceStopped !== true ||
    typeof options.owner !== 'string' || !options.owner || value.ownerThreadId !== options.owner ||
    !Number.isFinite(expiry) || expiry <= now.getTime() || expiry - now.getTime() > 3600000 ||
    !['handover', 'completed'].includes(value.businessDelivery)) throw new Error('MAINTENANCE_AUTHORITY_INVALID');
  if (mode === 'daily' && value.businessDelivery !== 'completed') throw new Error('MAINTENANCE_DELIVERY_NOT_COMPLETED');
  return now;
}
function legacy(path: string): { decisions: Decision[]; registry:Record<string,unknown>;fingerprint: string } {
  const value = readJson(path, 'MAINTENANCE_REGISTRY_INVALID');
  if (!Array.isArray(value.feedbackRevisions) || value.feedbackRevisions.some((row: any) =>
    !row || typeof row.id !== 'string' || !row.id || (row.decision !== undefined && typeof row.decision !== 'string') ||
    (row.revision !== undefined && (!Number.isSafeInteger(row.revision) || row.revision < 1))))
    throw new Error('MAINTENANCE_REGISTRY_INVALID');
  return { decisions: value.feedbackRevisions,registry:value,
  fingerprint: hash(readFileSync(path)) };
}
function validItems(value: unknown): value is Item[] {
  return Array.isArray(value) && new Set(value.map(item => item?.id)).size === value.length && value.every(row =>
    row && typeof row.id === 'string' && typeof row.kind === 'string' && /^[0-9a-f]{64}$/.test(row.fingerprint));
}
function state(path: string): State {
  const value = readJson(path, 'MAINTENANCE_STATE_INVALID');
  if (value.schemaVersion !== 'amazonops-maintenance/2' || value.project !== PROJECT || value.scope !== 'main' ||
    !/^[0-9a-f]{64}$/.test(value.sourceIdentity) || !/^[0-9a-f]{64}$/.test(value.registrySha256) ||
    typeof value.checkpointRoot!=='string'||!/^[0-9a-f]{64}$/.test(value.checkpointSourceIdentity)||
    !value.legacyRegistry||canonical(value.legacyRegistry.feedbackRevisions)!==canonical(value.legacyDecisions)||
    !Array.isArray(value.legacyDecisions) || value.legacyDecisions.some((row: any) => !row || typeof row.id !== 'string') ||
    !value.snapshot || !['feedback', 'pendingCapture', 'tombstones'].every(key => validItems(value.snapshot[key])) ||
    !value.initializedSnapshot||!['feedback','pendingCapture','tombstones'].every(key=>validItems(value.initializedSnapshot[key]))||
    ![value.snapshot,value.initializedSnapshot].every(snapshot=>snapshot.privacyLedgerSha256===null||/^[0-9a-f]{64}$/.test(snapshot.privacyLedgerSha256)))
    throw new Error('MAINTENANCE_STATE_INVALID');
  return value;
}
function compare(before: Item[], after: Item[], decisions: Map<string, Decision>) {
  const old = new Map(before.map(row => [row.id, row])), next = new Map(after.map(row => [row.id, row]));
  const reference = (row: Item) => ({ ...row, ...(decisions.has(row.id) ? { previousDecision: decisions.get(row.id)!.decision } : {}) });
  return { added: after.filter(row => !old.has(row.id)).map(reference),
    removed: before.filter(row => !next.has(row.id)).map(reference),
    changed: after.filter(row => old.has(row.id) && row.fingerprint !== old.get(row.id)!.fingerprint).map(reference) };
}
export function initializeMaintenance(options: Options & { priorData:string;destination: string }) {
  const now = authority(options, 'handover_validation');
  if(typeof options.priorData!=='string'||!options.priorData)throw new Error('MAINTENANCE_CHECKPOINT_REQUIRED');
  const checkpointRoot=physical(options.priorData),dataRoot=physical(options.data);
  if(within(checkpointRoot,dataRoot)||within(dataRoot,checkpointRoot))throw new Error('MAINTENANCE_CHECKPOINT_OVERLAP');
  const destination = outputPath(options.destination, [options.data, options.priorData,options.registry, options.authority]);
  const registry = legacy(options.registry), prior=inspectData(checkpointRoot),captured = inspectData(dataRoot);
  if(canonical(inspectData(checkpointRoot).snapshot)!==canonical(prior.snapshot))throw new Error('MAINTENANCE_CHECKPOINT_CHANGED');
  if (legacy(options.registry).fingerprint !== registry.fingerprint) throw new Error('MAINTENANCE_REGISTRY_CHANGED');
  const value: State = { schemaVersion: 'amazonops-maintenance/2', project: PROJECT, scope: 'main', initializedAt: now.toISOString(),
    sourceIdentity: captured.sourceIdentity, registrySha256: registry.fingerprint, legacyDecisions: registry.decisions,legacyRegistry:registry.registry,
    checkpointRoot,checkpointSourceIdentity:prior.sourceIdentity,snapshot:prior.snapshot,initializedSnapshot:captured.snapshot };
  authority(options, 'handover_validation'); writeNew(destination, value);
  return { ok: true, feedbackCount: captured.snapshot.feedback.length, legacyHistoryCount: value.legacyDecisions.length,
    modelCalls: 0, newWaves: 0, canDevelop: false };
}
export function checkMaintenance(options: Options & { state: string; mode: string; output: string }) {
  if (!['handover_validation', 'daily'].includes(options.mode)) throw new Error('MAINTENANCE_MODE_INVALID');
  const mode = options.mode as Mode, now = authority(options, mode);
  const baseline = state(options.state), baselineBytes = readFileSync(options.state), registry = legacy(options.registry);
  const destination = outputPath(options.output, [options.data,baseline.checkpointRoot,options.registry, options.authority, options.state]);
  const captured = inspectData(options.data);
  if (captured.sourceIdentity !== baseline.sourceIdentity) throw new Error('MAINTENANCE_STATE_SOURCE_MISMATCH');
  if (!readFileSync(options.state).equals(baselineBytes)) throw new Error('MAINTENANCE_STATE_CHANGED');
  if (legacy(options.registry).fingerprint !== registry.fingerprint) throw new Error('MAINTENANCE_REGISTRY_CHANGED');
  const decisions = new Map(baseline.legacyDecisions.map(row => [row.id, row]));
  const feedback = compare(baseline.snapshot.feedback, captured.snapshot.feedback, decisions);
  const excludedReappeared = feedback.added.filter(row => /withdrawn|deleted|duplicate|excluded/.test(row.previousDecision ?? ''));
  const pendingCapture = compare(baseline.snapshot.pendingCapture, captured.snapshot.pendingCapture, decisions);
  const tombstones = compare(baseline.snapshot.tombstones, captured.snapshot.tombstones, decisions);
  const registryBytesChanged = baseline.registrySha256 !== registry.fingerprint;
  const registryChanged = canonical(baseline.legacyDecisions) !== canonical(registry.decisions);
  const privacyChanged = baseline.snapshot.privacyLedgerSha256 !== captured.snapshot.privacyLedgerSha256;
  const pendingCaptureOutstanding = captured.snapshot.pendingCapture.some(item => item.kind === 'job');
  const legacyOutstanding=baseline.legacyDecisions.filter(row=>!reviewedDecisions.has(row.decision??''));
  const unregisteredFeedback=captured.snapshot.feedback.filter(row=>!decisions.has(row.id));
  const actionable = legacyOutstanding.length>0||unregisteredFeedback.length>0||pendingCaptureOutstanding || registryChanged || privacyChanged || [feedback, tombstones]
    .some(group => group.added.length + group.changed.length + group.removed.length > 0) ||
    pendingCapture.added.length + pendingCapture.changed.length > 0;
  const report = { schemaVersion: 'amazonops-maintenance-check/1', mode, checkedAt: now.toISOString(), sourceStable: true,
    actionable, canDevelop: false, modelCalls: 0, newWaves: 0, legacyHistoryCount: baseline.legacyDecisions.length,
    registryChanged, registryBytesChanged, privacyChanged, pendingCaptureOutstanding,legacyOutstanding,unregisteredFeedback,
    changes: { feedback: { ...feedback, excludedReappeared }, pendingCapture, tombstones },
    nextSnapshot: captured.snapshot, baselineSha256: hash(baselineBytes) };
  authority(options, mode); noLinks(options.state); writeNew(destination, report);
  return report;
}
