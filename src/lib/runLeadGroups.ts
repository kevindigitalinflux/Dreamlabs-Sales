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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Day of week (0 = Sunday) of a Gregorian calendar date, by pure arithmetic (no Date, so no time zone). */
export function weekdayIndex(y: number, m: number, d: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d) % 7;
}

/**
 * Formats a stored calendar date ('YYYY-MM-DD') as e.g. 'Thu 8 Oct 2026'.
 * Pure arithmetic on the date parts, so the result never depends on the machine time zone;
 * returns the input unchanged if it is not a valid date.
 */
export function formatWindowDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return value;
  return `${WEEKDAYS[weekdayIndex(y, mo, d)]} ${d} ${MONTHS[mo - 1]} ${y}`;
}

/** Email log statuses that still leave a parked draft open for the user to review (a failed send can be retried). */
const OPEN_LOG_STATUSES = ['draft', 'failed'];

/** How a "needs input" row stands, judged from its draft email's current status. */
export type NeedsInputResolution = 'open' | 'checking' | 'lookup_failed' | 'no_draft' | 'sent' | 'discarded';

/** State of the draft status lookup: loaded, still loading, or failed. */
export type DraftLookup = 'ready' | 'checking' | 'failed';

/**
 * Where a needs-input row stands. `logStatuses` maps email log id to its current status;
 * a log id missing from the map means the draft no longer exists (discarded).
 */
export function needsInputResolution(
  row: { email_log_id: string | null },
  logStatuses: ReadonlyMap<string, string>,
): NeedsInputResolution {
  if (!row.email_log_id) return 'no_draft';
  const status = logStatuses.get(row.email_log_id);
  if (status === undefined) return 'discarded';
  if (status === 'sent') return 'sent';
  return OPEN_LOG_STATUSES.includes(status) ? 'open' : 'discarded';
}

/**
 * Derives the displayed state of run rows without writing anything: a needs-input row whose draft
 * was sent by the user shows as sent ("Sent by you after review"), and one whose draft was removed
 * says so. Every row gets a `resolution` ('open' for rows that are not needs-input).
 * While the lookup is `checking` or `failed`, nothing can be concluded: needs-input rows with a draft become
 * 'checking' or 'lookup_failed' (never 'open', 'discarded' or 'sent'), so no send action is offered.
 */
export function applyDraftResolution<T extends { status: string; reason: string | null; email_log_id: string | null }>(
  rows: T[],
  logStatuses: ReadonlyMap<string, string>,
  lookup: DraftLookup = 'ready',
): (T & { resolution: NeedsInputResolution })[] {
  return rows.map((row) => {
    if (row.status !== 'needs_input') return { ...row, resolution: 'open' as const };
    const resolution: NeedsInputResolution = row.email_log_id && lookup !== 'ready'
      ? (lookup === 'failed' ? 'lookup_failed' : 'checking')
      : needsInputResolution(row, logStatuses);
    if (resolution === 'sent') return { ...row, status: 'sent', reason: 'Sent by you after review', resolution };
    if (resolution === 'discarded') return { ...row, reason: 'Draft was discarded', resolution };
    return { ...row, resolution };
  });
}

/** How many needs-input rows still have an open draft waiting for the user. */
export function countOpenNeedsInput(
  rows: { status: string; email_log_id: string | null }[],
  logStatuses: ReadonlyMap<string, string>,
): number {
  return rows.filter((r) => r.status === 'needs_input' && needsInputResolution(r, logStatuses) === 'open' && r.email_log_id !== null).length;
}

/** Whether to enrol a lead in the row's sequence after the user sent its parked draft. */
export function shouldEnrolAfterSend(opts: { logStatus: string | undefined; sequenceId: string | null; hasActiveEnrollment: boolean }): boolean {
  return opts.logStatus === 'sent' && opts.sequenceId !== null && !opts.hasActiveEnrollment;
}
