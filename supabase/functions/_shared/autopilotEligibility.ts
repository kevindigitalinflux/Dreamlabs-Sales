// Pure eligibility and time-window maths for selected-lead autopilot.
// No imports: shared by the browser picker (via Vitest/Vite) and the Deno edge function.

export interface EligibilityLead { id: string; opted_out: boolean; email: string | null; stage: string; last_contacted_at: string | null }
export interface EligibilityEnrollment { status: 'active' | 'paused' | 'completed' | 'cancelled'; next_send_at: string | null }
export type EligibilityResult =
  | { eligible: true; reason: 'new' | 'due' }
  | { eligible: false; reason: 'opted_out' | 'blocked' | 'closed' | 'paused' | 'not_due' | 'recently_contacted' };

export const RECENT_CONTACT_DAYS = 14;

/**
 * Decides whether autopilot may act on a lead right now.
 * A lead with no email is still eligible here; the engine decides what to do.
 * `endOfToday` MUST come from `endOfLocalDay(now, timeZone)`, not UTC midnight.
 * Blocklist entries (emails or domains) are trimmed and lower-cased before comparing.
 * Rule order: opted_out, closed, blocked, paused, active (due/not_due), recently_contacted, new.
 * A cancelled or completed enrolment counts as no active enrolment.
 * Recently contacted means strictly less than RECENT_CONTACT_DAYS * 24h ago, so exactly 14 days ago is eligible.
 */
export function classifyLead(lead: EligibilityLead, enrollment: EligibilityEnrollment | null, blocked: Set<string>, endOfToday: Date, now: Date): EligibilityResult {
  if (lead.opted_out) return { eligible: false, reason: 'opted_out' };
  if (lead.stage === 'won' || lead.stage === 'lost') return { eligible: false, reason: 'closed' };
  if (lead.email) {
    const norm = new Set([...blocked].map((b) => b.trim().toLowerCase()));
    const email = lead.email.trim().toLowerCase();
    const domain = email.split('@')[1];
    if (norm.has(email) || (domain && norm.has(domain))) return { eligible: false, reason: 'blocked' };
  }
  if (enrollment?.status === 'paused') return { eligible: false, reason: 'paused' };
  if (enrollment?.status === 'active') {
    const due = enrollment.next_send_at !== null && new Date(enrollment.next_send_at).getTime() <= endOfToday.getTime();
    return due ? { eligible: true, reason: 'due' } : { eligible: false, reason: 'not_due' };
  }
  if (lead.last_contacted_at) {
    const ageMs = now.getTime() - new Date(lead.last_contacted_at).getTime();
    if (ageMs < RECENT_CONTACT_DAYS * 86400000) return { eligible: false, reason: 'recently_contacted' };
  }
  return { eligible: true, reason: 'new' };
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock date ('YYYY-MM-DD') and time ('HH:MM') in an IANA time zone to the UTC instant.
 * An invalid time zone throws RangeError (from Intl); a malformed date or time string throws RangeError too.
 * A nonexistent local time (spring-forward gap) resolves to the instant using the pre-transition offset,
 * so it lands after the gap (London 2026-03-29 01:30 is 01:30Z, which is 02:30 BST).
 * An ambiguous local time (fall-back overlap) resolves to the later occurrence, the post-transition offset
 * (London 2026-10-25 01:30 is 01:30Z, i.e. GMT).
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  const first = guess - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - tzOffsetMs(new Date(first), timeZone));
}

/** 'YYYY-MM-DD' of an instant as seen in the given time zone. */
export function localDateString(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Last millisecond of the zone's local day containing the instant (correct on 23h and 25h DST days). */
export function endOfLocalDay(instant: Date, timeZone: string): Date {
  const [y, m, d] = localDateString(instant, timeZone).split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
  return new Date(zonedTimeToUtc(next, '00:00', timeZone).getTime() - 1);
}

/** UTC bounds of a sending window on a given local date, or null if end is not after start. */
export function windowBounds(dateStr: string, start: string, end: string, timeZone: string): { startUtc: Date; endUtc: Date } | null {
  const startUtc = zonedTimeToUtc(dateStr, start, timeZone);
  const endUtc = zonedTimeToUtc(dateStr, end, timeZone);
  if (endUtc.getTime() <= startUtc.getTime()) return null;
  return { startUtc, endUtc };
}

/** True when now is within the window: start inclusive, end exclusive. */
export function inWindow(now: Date, bounds: { startUtc: Date; endUtc: Date }): boolean {
  const t = now.getTime();
  return t >= bounds.startUtc.getTime() && t < bounds.endUtc.getTime();
}

/** Names of any {{placeholders}} still present in text. Duplicates are returned as repeats; callers dedupe. */
export function findUnfilledPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!);
}
