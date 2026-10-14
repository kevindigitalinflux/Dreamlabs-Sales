// src/lib/jobs/view.ts
// Pure view helpers over JobItem lists: grouping for the Jobs page, the notification bar's lines, the tab title count.
import type { JobItem } from './model';

export const OLDER_DAYS = 14;
export const RECENT_FINISH_HOURS = 24;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface JobGroups { needsYou: JobItem[]; running: JobItem[]; finished: JobItem[]; older: JobItem[] }

const time = (iso: string | null): number => (iso ? new Date(iso).getTime() : NaN);
const byStartedDesc = (a: JobItem, b: JobItem) => time(b.startedAt) - time(a.startedAt);
const byFinishedDesc = (a: JobItem, b: JobItem) => (time(b.finishedAt) || time(b.startedAt)) - (time(a.finishedAt) || time(a.startedAt));

export function groupJobs(items: JobItem[], now: Date): JobGroups {
  const cutoff = now.getTime() - OLDER_DAYS * DAY_MS;
  const groups: JobGroups = { needsYou: [], running: [], finished: [], older: [] };
  for (const job of items) {
    if (job.state === 'needs_you') groups.needsYou.push(job);
    else if (job.state === 'running') groups.running.push(job);
    else {
      const finishedAt = time(job.finishedAt);
      (Number.isNaN(finishedAt) || finishedAt >= cutoff ? groups.finished : groups.older).push(job);
    }
  }
  groups.needsYou.sort(byStartedDesc);
  groups.running.sort(byStartedDesc);
  groups.finished.sort(byFinishedDesc);
  groups.older.sort(byFinishedDesc);
  return groups;
}

/** Identifies one finished event; a job that finishes again later gets a new key. */
export const seenKey = (job: JobItem): string => `${job.id}@${job.finishedAt ?? ''}`;

/** Done or failed (not user-stopped) jobs that finished within the last 24 hours and have not been seen. Never the campaign. */
export function unseenFinished(items: JobItem[], seen: ReadonlySet<string>, now: Date): JobItem[] {
  const cutoff = now.getTime() - RECENT_FINISH_HOURS * HOUR_MS;
  return items.filter((j) => j.kind !== 'campaign' && (j.state === 'done' || j.state === 'failed')
    && !Number.isNaN(time(j.finishedAt)) && time(j.finishedAt) >= cutoff && !seen.has(seenKey(j)));
}

export interface NotifyLine { key: string; jobId: string; tone: 'needs_you' | 'running' | 'finished'; text: string; href: string; dismissible: boolean }

export function notifyLines(items: JobItem[], seen: ReadonlySet<string>, now: Date, max = 3): { lines: NotifyLine[]; more: number } {
  const real = items.filter((j) => j.kind !== 'campaign');
  const all: NotifyLine[] = [
    ...real.filter((j) => j.state === 'needs_you').sort(byStartedDesc)
      .map((j): NotifyLine => ({ key: `need:${j.id}`, jobId: j.id, tone: 'needs_you', text: `${j.title}: ${j.detail}`, href: j.href, dismissible: false })),
    ...real.filter((j) => j.state === 'running').sort(byStartedDesc)
      .map((j): NotifyLine => ({ key: `run:${j.id}`, jobId: j.id, tone: 'running', text: `${j.title}: ${j.detail}`, href: j.href, dismissible: false })),
    ...unseenFinished(real, seen, now).sort(byFinishedDesc)
      .map((j): NotifyLine => ({ key: seenKey(j), jobId: j.id, tone: 'finished', text: `${j.title}: ${j.state === 'failed' ? 'did not finish' : 'finished'}`, href: j.href, dismissible: true })),
  ];
  return { lines: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/** Needs-you jobs plus unseen recent finished jobs (never running, never the campaign). */
export function tabTitleCount(items: JobItem[], seen: ReadonlySet<string>, now: Date): number {
  return items.filter((j) => j.kind !== 'campaign' && j.state === 'needs_you').length + unseenFinished(items, seen, now).length;
}

export const tabTitle = (count: number, base = 'Dreamlabs Sales'): string => (count > 0 ? `(${count}) ${base}` : base);

/** "3 jobs, 1 needs you" for a phone, or null when there is nothing to say. */
export function summaryLine(items: JobItem[], seen: ReadonlySet<string>, now: Date): string | null {
  const real = items.filter((j) => j.kind !== 'campaign');
  const needs = real.filter((j) => j.state === 'needs_you').length;
  const total = needs + real.filter((j) => j.state === 'running').length + unseenFinished(real, seen, now).length;
  if (total === 0) return null;
  return `${total} ${total === 1 ? 'job' : 'jobs'}${needs > 0 ? `, ${needs} ${needs === 1 ? 'needs' : 'need'} you` : ''}`;
}

export function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
