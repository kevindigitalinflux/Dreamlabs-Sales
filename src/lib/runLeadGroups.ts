import type { AutopilotRun } from '../types';

/** The groups a selected run's leads are shown in, in display order. */
export type RunLeadGroupKey = 'sent' | 'needs_input' | 'skipped' | 'not_reached' | 'failed' | 'queued';

export const RUN_LEAD_GROUP_ORDER: RunLeadGroupKey[] = ['sent', 'needs_input', 'skipped', 'not_reached', 'failed', 'queued'];

const GROUP_TITLES: Record<RunLeadGroupKey, string> = {
  sent: 'Sent',
  needs_input: 'Needs your input',
  skipped: 'Skipped',
  not_reached: 'Not reached',
  failed: 'Failed',
  queued: 'Still queued',
};

/** The heading for a group. */
export function groupTitle(key: RunLeadGroupKey): string {
  return GROUP_TITLES[key];
}

/** Which group a row status belongs in. Unknown statuses go to "Still queued" so they are never reported as sent. */
export function groupKeyFor(status: string): RunLeadGroupKey {
  switch (status) {
    case 'sent': return 'sent';
    case 'needs_input': return 'needs_input';
    case 'skipped': return 'skipped';
    case 'not_reached': return 'not_reached';
    case 'failed': return 'failed';
    default: return 'queued';
  }
}

export interface RunLeadGroup<T> { key: RunLeadGroupKey; title: string; rows: T[] }

/**
 * Splits rows into the fixed display groups (empty groups included, in order).
 * Rows inside a group are ordered by updated_at ascending; ties keep their original order.
 */
export function groupRunLeads<T extends { status: string; updated_at: string }>(rows: T[]): RunLeadGroup<T>[] {
  const buckets = new Map<RunLeadGroupKey, { row: T; index: number }[]>(RUN_LEAD_GROUP_ORDER.map((k) => [k, []]));
  rows.forEach((row, index) => buckets.get(groupKeyFor(row.status))?.push({ row, index }));
  return RUN_LEAD_GROUP_ORDER.map((key) => ({
    key,
    title: GROUP_TITLES[key],
    rows: (buckets.get(key) ?? [])
      .sort((a, b) => (Date.parse(a.row.updated_at) || 0) - (Date.parse(b.row.updated_at) || 0) || a.index - b.index)
      .map((x) => x.row),
  }));
}

/** Row counts per group (every group present, zero when empty). */
export function countRunLeads(rows: { status: string }[]): Record<RunLeadGroupKey, number> {
  const counts: Record<RunLeadGroupKey, number> = { sent: 0, needs_input: 0, skipped: 0, not_reached: 0, failed: 0, queued: 0 };
  for (const r of rows) counts[groupKeyFor(r.status)] += 1;
  return counts;
}

/** Plain-English label for a run's status. */
export function runStatusLabel(status: string): string {
  if (status === 'active') return 'Running';
  if (status === 'completed') return 'Finished';
  if (status === 'cancelled') return 'Stopped';
  return 'Unknown';
}

/**
 * Why a finished run ended early, if it did ("Send cap reached", "Finish time reached"),
 * or null for a run that simply worked through its list or is still running.
 */
export function runFinishNote(
  run: Pick<AutopilotRun, 'status' | 'cancel_reason'>,
  rows: { status: string; reason: string | null }[],
): string | null {
  if (run.status === 'active') return null;
  const reason = (run.cancel_reason ?? '').toLowerCase();
  if (reason.includes('send cap')) return 'Send cap reached';
  if (reason.includes('spend cap')) return 'Spend cap reached';
  if (run.status === 'completed' && rows.some((r) => r.status === 'not_reached' && /finish time/i.test(r.reason ?? ''))) {
    return 'Finish time reached';
  }
  return null;
}
