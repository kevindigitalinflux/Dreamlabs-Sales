import type { JobItem } from './model';
import { notifyLines } from './view';

export const popupKey = (job: JobItem): string => `popup:${job.id}:${job.state}:${job.finishedAt ?? ''}:`;
export interface JobPopup { title: string; body: string; tag: string; href: string; keys: string[] }

export function decidePopups(input: {
  previous: JobItem[] | null; next: JobItem[]; seen: ReadonlySet<string>; hidden: boolean;
  enabled: boolean; permission: string; now: Date;
}): JobPopup[] {
  const { previous, next, seen, hidden, enabled, permission, now } = input;
  if (previous === null || !hidden || !enabled || permission !== 'granted') return [];
  const before = new Map(previous.map((j) => [j.id, j]));
  // Share the bar's eligibility, age, seen and priority rules, then keep only transitions.
  const eligible = notifyLines(next, seen, now, Number.MAX_SAFE_INTEGER).lines;
  const candidates = eligible.flatMap((line): JobPopup[] => {
    const job = next.find((j) => j.id === line.jobId)!;
    if (line.tone === 'running') return [];
    let key = popupKey(job);
    if (job.state === 'needs_you') {
      // Only entry starts an episode. Counts/progress within it are silent.
      if (before.get(job.id)?.state === 'needs_you') return [];
      // The delivered store distinguishes re-entry from earlier episodes, even at the same count.
      let episode = 1;
      while (seen.has(`${key}episode:${episode}`)) episode++;
      key = `${key}episode:${episode}`;
    } else if ((before.has(job.id) && popupKey(before.get(job.id)!) === key) || seen.has(key)) return [];
    const label = job.state === 'needs_you' ? 'Needs you' : job.state === 'failed' ? 'Failed' : 'Finished';
    return [{ title: `${label}: ${job.title}`, body: job.detail, tag: `${job.id}:${job.state}`, href: job.href, keys: [key] }];
  });
  if (candidates.length <= 3) return candidates;
  return [...candidates.slice(0, 3), {
    title: `+${candidates.length - 3} more jobs`, body: 'Open Jobs to see what changed.', tag: 'jobs:more', href: '/jobs',
    keys: candidates.slice(3).flatMap((p) => p.keys),
  }];
}
