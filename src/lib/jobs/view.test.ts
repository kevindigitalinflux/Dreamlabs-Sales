import { describe, expect, it } from 'vitest';
import type { JobItem } from './model';
import { groupJobs, notifyLines, seenKey, summaryLine, tabTitle, tabTitleCount, timeAgo, unseenFinished } from './view';

const NOW = new Date('2026-10-14T12:00:00Z');
const job = (over: Partial<JobItem> = {}): JobItem => ({
  id: 'deep_find:r1', kind: 'deep_find', sourceId: 'r1', title: 'Love Living, FMJ +3', detail: '2 of 5 leads done', state: 'running',
  progress: { done: 2, total: 5 }, needsYou: 0, startedAt: '2026-10-14T10:00:00Z', finishedAt: null, href: '/pipeline/deep-find/r1',
  canStop: true, canDelete: false, deleteWarning: null, ...over,
});
const finished = (id: string, finishedAt: string | null, over: Partial<JobItem> = {}) =>
  job({ id, sourceId: id, state: 'done', detail: 'done', finishedAt, canStop: false, canDelete: true, ...over });

describe('groupJobs', () => {
  it('splits into needs-you, running, finished and older, newest first', () => {
    const items = [
      job({ id: 'a', state: 'running', startedAt: '2026-10-14T09:00:00Z' }),
      job({ id: 'b', state: 'running', startedAt: '2026-10-14T11:00:00Z' }),
      job({ id: 'c', state: 'needs_you', needsYou: 1 }),
      finished('d', '2026-10-13T10:00:00Z'),
      finished('e', '2026-10-14T08:00:00Z'),
      finished('f', '2026-09-01T10:00:00Z'),
    ];
    const g = groupJobs(items, NOW);
    expect(g.needsYou.map((j) => j.id)).toEqual(['c']);
    expect(g.running.map((j) => j.id)).toEqual(['b', 'a']);
    expect(g.finished.map((j) => j.id)).toEqual(['e', 'd']);
    expect(g.older.map((j) => j.id)).toEqual(['f']);
  });
  it('treats exactly 14 days as still recent and just over as older', () => {
    const edge = finished('edge', '2026-09-30T12:00:00Z');
    const over = finished('over', '2026-09-30T11:59:59Z');
    const g = groupJobs([edge, over], NOW);
    expect(g.finished.map((j) => j.id)).toEqual(['edge']);
    expect(g.older.map((j) => j.id)).toEqual(['over']);
  });
  it('a finished job with no finishedAt is kept in finished (never hidden)', () => {
    expect(groupJobs([finished('x', null)], NOW).finished.map((j) => j.id)).toEqual(['x']);
  });
  it('an old needs-you job is still needs-you', () => {
    const g = groupJobs([job({ id: 'old', state: 'needs_you', needsYou: 2, startedAt: '2026-01-01T00:00:00Z' })], NOW);
    expect(g.needsYou).toHaveLength(1);
    expect(g.older).toHaveLength(0);
  });
  it('handles an empty list', () => {
    expect(groupJobs([], NOW)).toEqual({ needsYou: [], running: [], finished: [], older: [] });
  });
});

describe('seenKey, unseenFinished', () => {
  it('keys by id and finish time, and only recent done or failed jobs count as unseen finished', () => {
    const recent = finished('r', '2026-10-14T11:00:00Z');
    const failed = finished('f', '2026-10-14T10:00:00Z', { state: 'failed' });
    const stopped = finished('s', '2026-10-14T10:30:00Z', { state: 'stopped' });
    const stale = finished('old', '2026-10-13T11:59:59Z');
    const camp = finished('c', '2026-10-14T11:00:00Z', { kind: 'campaign' });
    const noTime = finished('n', null);
    expect(seenKey(recent)).toBe('r@2026-10-14T11:00:00Z');
    expect(seenKey(noTime)).toBe('n@');
    const unseen = unseenFinished([recent, failed, stopped, stale, camp, noTime], new Set(), NOW);
    expect(unseen.map((j) => j.id)).toEqual(['r', 'f']);
    expect(unseenFinished([recent, failed], new Set([seenKey(recent)]), NOW).map((j) => j.id)).toEqual(['f']);
  });
});

describe('notifyLines', () => {
  it('orders needs-you, then running, then unseen finished, and leaves out the campaign', () => {
    const items = [
      finished('fin', '2026-10-14T11:30:00Z', { title: 'Done job', detail: 'x' }),
      job({ id: 'run', title: 'Running job', detail: '1 of 3 leads done' }),
      job({ id: 'need', state: 'needs_you', needsYou: 1, title: 'Waiting job', detail: '1 lead needs you (choose a company or check people)', href: '/pipeline/deep-find/need' }),
      job({ id: 'camp', kind: 'campaign', title: 'Autopilot campaign' }),
    ];
    const { lines, more } = notifyLines(items, new Set(), NOW);
    expect(lines.map((l) => [l.tone, l.jobId])).toEqual([['needs_you', 'need'], ['running', 'run'], ['finished', 'fin']]);
    expect(more).toBe(0);
    expect(lines[0]).toMatchObject({ text: 'Waiting job: 1 lead needs you (choose a company or check people)', href: '/pipeline/deep-find/need', dismissible: false });
    expect(lines[1]).toMatchObject({ text: 'Running job: 1 of 3 leads done', dismissible: false });
    expect(lines[2]).toMatchObject({ text: 'Done job: finished', dismissible: true, key: 'fin@2026-10-14T11:30:00Z' });
  });
  it('caps at three lines and reports how many more', () => {
    const items = [1, 2, 3, 4, 5].map((n) => job({ id: `j${n}`, startedAt: `2026-10-14T0${n}:00:00Z` }));
    const { lines, more } = notifyLines(items, new Set(), NOW);
    expect(lines).toHaveLength(3);
    expect(more).toBe(2);
    expect(notifyLines(items, new Set(), NOW, 2)).toMatchObject({ more: 3 });
  });
  it('failed jobs read as did not finish; seen finished jobs drop out; needs-you never drops', () => {
    const failed = finished('bad', '2026-10-14T11:00:00Z', { state: 'failed', title: 'Search' });
    expect(notifyLines([failed], new Set(), NOW).lines[0].text).toBe('Search: did not finish');
    expect(notifyLines([failed], new Set([seenKey(failed)]), NOW).lines).toEqual([]);
    const need = job({ id: 'n', state: 'needs_you', needsYou: 1 });
    expect(notifyLines([need], new Set(['n@']), NOW).lines).toHaveLength(1);
  });
  it('is empty when there is nothing to say', () => {
    expect(notifyLines([], new Set(), NOW)).toEqual({ lines: [], more: 0 });
  });
});

describe('tab title and phone summary', () => {
  const items = [
    job({ id: 'n1', state: 'needs_you', needsYou: 1 }),
    job({ id: 'r1' }),
    finished('f1', '2026-10-14T11:00:00Z'),
    finished('f2', '2026-10-14T10:00:00Z'),
    job({ id: 'camp', kind: 'campaign' }),
  ];
  it('counts needs-you plus unseen recent finished (not running, not the campaign)', () => {
    expect(tabTitleCount(items, new Set(), NOW)).toBe(3);
    expect(tabTitleCount(items, new Set([seenKey(items[2]), seenKey(items[3])]), NOW)).toBe(1);
    expect(tabTitleCount([], new Set(), NOW)).toBe(0);
  });
  it('builds the title', () => {
    expect(tabTitle(0)).toBe('Dreamlabs Sales');
    expect(tabTitle(3)).toBe('(3) Dreamlabs Sales');
    expect(tabTitle(2, 'Other')).toBe('(2) Other');
  });
  it('summarises for a phone', () => {
    expect(summaryLine(items, new Set(), NOW)).toBe('4 jobs, 1 needs you');
    expect(summaryLine([job({ id: 'only' })], new Set(), NOW)).toBe('1 job');
    expect(summaryLine([job({ id: 'a', state: 'needs_you', needsYou: 2 }), job({ id: 'b', state: 'needs_you', needsYou: 1 })], new Set(), NOW)).toBe('2 jobs, 2 need you');
    expect(summaryLine([], new Set(), NOW)).toBeNull();
  });
});

describe('timeAgo', () => {
  it('reads naturally', () => {
    expect(timeAgo('2026-10-14T11:59:40Z', NOW)).toBe('just now');
    expect(timeAgo('2026-10-14T11:55:00Z', NOW)).toBe('5 minutes ago');
    expect(timeAgo('2026-10-14T11:59:00Z', NOW)).toBe('1 minute ago');
    expect(timeAgo('2026-10-14T10:00:00Z', NOW)).toBe('2 hours ago');
    expect(timeAgo('2026-10-14T11:00:00Z', NOW)).toBe('1 hour ago');
    expect(timeAgo('2026-10-12T12:00:00Z', NOW)).toBe('2 days ago');
    expect(timeAgo('2026-10-13T12:00:00Z', NOW)).toBe('1 day ago');
  });
  it('never shows the future or a bad date as nonsense', () => {
    expect(timeAgo('2026-10-14T12:30:00Z', NOW)).toBe('just now');
    expect(timeAgo('garbage', NOW)).toBe('');
  });
});
