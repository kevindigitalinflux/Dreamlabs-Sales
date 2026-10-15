import { nameLeads, type JobItem } from './model';
export interface LookupJobInput {
  id: string; org_id: string; created_by: string; kind: 'enrich' | 'decision_makers';
  status: 'active' | 'completed' | 'cancelled'; lead_count: number; created_at: string; finished_at: string | null;
}
export interface LookupRowInput {
  status: 'queued' | 'running' | 'done' | 'failed' | 'skipped'; review: 'none' | 'pending' | 'applied' | 'dismissed';
}
export function mapLookupJob(job: LookupJobInput, rows: LookupRowInput[], names: Array<string | null>, viewer: { userId: string | null; isAdmin: boolean }): JobItem {
  const needsYou = job.kind === 'enrich' ? rows.filter((r) => r.review === 'pending').length : 0;
  const done = rows.filter((r) => r.status !== 'queued' && r.status !== 'running').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const total = job.status === 'active' ? Math.max(job.lead_count, rows.length) : rows.length;
  const allowed = viewer.userId !== null && (job.created_by === viewer.userId || viewer.isAdmin);
  const state = needsYou ? 'needs_you' : job.status === 'active' ? 'running' : job.status === 'cancelled' ? 'stopped' : failed > 0 ? 'failed' : 'done';
  return {
    id: `lookup:${job.id}`, kind: 'lookup', sourceId: job.id,
    title: `${job.kind === 'enrich' ? 'Fill in details' : 'Find decision makers'}: ${nameLeads(names, total)}`,
    state, progress: { done, total }, needsYou,
    detail: needsYou ? `${needsYou} ${needsYou === 1 ? 'lead has' : 'leads have'} details to review`
      : state === 'stopped' ? `Stopped after ${done} of ${total} leads`
      : `${done} of ${total} leads done${failed ? `, ${failed} failed` : ''}`,
    startedAt: job.created_at, finishedAt: job.finished_at, href: `/jobs/lookup/${job.id}`,
    canStop: allowed && job.status === 'active', canDelete: allowed && job.status !== 'active',
    deleteBlockedReason: allowed ? null : 'Only the creator or an organisation admin can delete this job.',
    deleteWarning: 'Proposals you have not reviewed are removed too. Details already applied to leads stay.',
  };
}
