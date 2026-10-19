import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScrapeJob } from '../types';

// Minimal hook lifecycle host: effects run after render and clean up on dependency changes.
// This keeps the polling regression executable without adding a browser test dependency.
const host = vi.hoisted(() => ({ cursor: 0, slots: [] as Array<{
  value?: unknown; deps?: unknown[]; cleanup?: (() => void) | void;
}>, effects: [] as Array<() => void>, jobs: [] as ScrapeJob[], reads: 0 }));
vi.mock('react', () => {
  const slot = () => host.slots[host.cursor++] ?? (host.slots[host.cursor - 1] = {});
  const changed = (before: unknown[] | undefined, next: unknown[]) => !before || next.some((v, i) => !Object.is(v, before[i]));
  const useMemo = (compute: () => unknown, deps: unknown[]) => {
    const current = slot();
    if (changed(current.deps, deps)) { current.value = compute(); current.deps = deps; }
    return current.value;
  };
  return {
    useState: (initial: unknown) => {
      const current = slot();
      if (!('value' in current)) current.value = typeof initial === 'function' ? initial() : initial;
      return [current.value, (value: unknown) => { current.value = value; }];
    },
    useRef: (initial: unknown) => useMemo(() => ({ current: initial }), []),
    useMemo,
    useCallback: (callback: unknown, deps: unknown[]) => useMemo(() => callback, deps),
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const current = slot();
      if (changed(current.deps, deps)) {
        current.deps = deps;
        host.effects.push(() => { current.cleanup?.(); current.cleanup = effect(); });
      }
    },
  };
});
vi.mock('./supabase', () => ({ supabase: {
  from: (table: string) => {
    host.reads++;
    let single = false;
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'in', 'order', 'range']) query[method] = () => query;
    query.single = () => { single = true; return query; };
    query.then = (resolve: (value: unknown) => unknown) => resolve({
      data: table === 'scrape_jobs' ? single ? host.jobs[0] : host.jobs : [], error: null,
    });
    return query;
  },
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
} }));
import { useScrapeJob } from '../hooks/useScrapeJob';

function render() {
  host.cursor = 0;
  const result = useScrapeJob('a');
  host.effects.splice(0).forEach((effect) => effect());
  return result;
}
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  return render();
}
function setup(grouped = false) {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  host.cursor = 0; host.slots = []; host.effects = []; host.reads = 0;
  host.jobs = [{ id: 'a', org_id: 'org', created_by: 'user', status: 'completed',
    created_at: new Date().toISOString(), sources: ['google_places'], icp_params: grouped ? {
      scrape_group: { id: '12345678-1234-4234-8234-123456789abc', sources: ['google_places', 'companies_house'] },
    } : {} } as ScrapeJob];
}
afterEach(() => { host.slots.forEach((slot) => slot.cleanup?.()); vi.useRealTimers(); });

describe('scrape polling lifecycle', () => {
  it('loads a finished legacy job once, stops its timer, and memoises merged rows across renders', async () => {
    setup(); render(); const result = await settle();
    expect(vi.getTimerCount()).toBe(0);
    expect(render().rawLeads).toBe(result.rawLeads);
    await vi.advanceTimersByTimeAsync(20_000); await settle();
    expect(host.reads).toBe(2);
  });
  it('discovers missing sources, then stops when the last running job times out', async () => {
    setup(true); render(); await settle();
    expect(vi.getTimerCount()).toBe(1);
    host.jobs = [...host.jobs, { ...host.jobs[0], id: 'b', sources: ['companies_house'], status: 'running' }];
    await vi.advanceTimersByTimeAsync(5000); await settle();
    expect(vi.getTimerCount()).toBe(1);
    vi.setSystemTime(new Date('2026-10-19T12:10:00Z'));
    await vi.advanceTimersByTimeAsync(5000); await settle();
    expect(vi.getTimerCount()).toBe(0);
    const reads = host.reads;
    await vi.advanceTimersByTimeAsync(20_000); await settle();
    expect(host.reads).toBe(reads);
  });
  it('stops when every expected source completes normally', async () => {
    setup(true); render(); await settle();
    host.jobs = [...host.jobs, { ...host.jobs[0], id: 'b', sources: ['companies_house'] }];
    await vi.advanceTimersByTimeAsync(5000); await settle();
    expect(vi.getTimerCount()).toBe(0);
  });
});
