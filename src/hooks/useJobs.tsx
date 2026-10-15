import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { cancelDeepFind } from '../lib/deepFind';
import { JOB_SOURCES, JOB_TABLE } from '../lib/jobs/sources';
import { isFinishedState, type JobItem, type JobKind } from '../lib/jobs/model';
import { groupJobs, seenKey, tabTitle, tabTitleCount, unseenFinished, type JobGroups } from '../lib/jobs/view';
import { readSeen, writeSeen } from '../lib/jobs/seen';
import { useOrg } from './useOrg';

const POLL_MS = 30_000;
const CLOCK_MS = 60_000;
const DEBOUNCE_MS = 600;
const BASE_TITLE = 'Dreamlabs Sales';

export interface JobsContextValue {
  jobs: JobItem[];
  groups: JobGroups;
  failedKinds: JobKind[];
  loading: boolean;
  now: Date;
  seen: ReadonlySet<string>;
  counts: { needsYou: number; running: number; notify: number };
  refresh(): Promise<void>;
  stop(jobId: string): Promise<string | null>;
  remove(jobId: string): Promise<string | null>;
  clearFinished(): Promise<{ deleted: number; failed: number }>;
  markFinishedSeen(): void;
  dismiss(key: string): void;
}

const JobsContext = createContext<JobsContextValue | null>(null);

const storage = (): Storage | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

/**
 * One instance for the whole signed-in app (mounted in AppShell). Loads every job source, keeps them live (realtime plus a
 * 30 s refetch), exposes the actions, owns the per-browser "seen" state and keeps the tab title in step. A source that
 * fails to load keeps its previously shown rows and is reported in failedKinds; the others are never hidden.
 */
export function JobsProvider({ children }: { children: ReactNode }) {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const instance = useId();
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [failedKinds, setFailedKinds] = useState<JobKind[]>([]);
  const [loading, setLoading] = useState(orgId !== null);
  const [now, setNow] = useState(() => new Date());
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const jobsRef = useRef<JobItem[]>([]);
  const tokenRef = useRef(0);
  jobsRef.current = jobs;

  const load = useCallback(async () => {
    if (!orgId) return;
    const token = tokenRef.current;
    const results = await Promise.allSettled(JOB_SOURCES.map((s) => s.load(orgId)));
    if (token !== tokenRef.current) return; // organisation changed meanwhile: drop the late answer
    const next: JobItem[] = [];
    const failed: JobKind[] = [];
    results.forEach((r, i) => {
      const kind = JOB_SOURCES[i]!.kind;
      if (r.status === 'fulfilled') next.push(...r.value);
      else {
        console.error(`jobs: ${kind} failed to load:`, r.reason instanceof Error ? r.reason.message : 'unknown');
        failed.push(kind);
        next.push(...jobsRef.current.filter((j) => j.kind === kind)); // keep what was already on screen
      }
    });
    next.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    setJobs(next);
    setFailedKinds(failed);
    setLoading(false);
  }, [orgId]);

  // Organisation change: start from nothing, load seen state for that organisation.
  useEffect(() => {
    tokenRef.current += 1;
    setJobs([]);
    setFailedKinds([]);
    setLoading(orgId !== null);
    setSeen(orgId ? readSeen(storage(), orgId) : new Set());
  }, [orgId]);

  // Live updates: realtime (debounced) plus a refetch every 30 s, and a clock for "x minutes ago" and the 14-day cut-off.
  useEffect(() => {
    if (!orgId) return;
    void load();
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = null; void load(); }, DEBOUNCE_MS);
    };
    let channel = supabase.channel(`jobs-${orgId}-${instance}`);
    const seenTables = new Set<string>();
    for (const source of JOB_SOURCES) {
      for (const w of source.watch) {
        const id = `${w.table}:${w.byOrg}`;
        if (seenTables.has(id)) continue;
        seenTables.add(id);
        channel = channel.on('postgres_changes',
          { event: '*', schema: 'public', table: w.table, ...(w.byOrg ? { filter: `org_id=eq.${orgId}` } : {}) }, schedule);
      }
    }
    channel.subscribe();
    const poll = window.setInterval(() => void load(), POLL_MS);
    const clock = window.setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(poll);
      window.clearInterval(clock);
      void supabase.removeChannel(channel);
    };
  }, [orgId, instance, load]);

  const groups = useMemo(() => groupJobs(jobs, now), [jobs, now]);
  const counts = useMemo(() => ({
    needsYou: jobs.filter((j) => j.kind !== 'campaign' && j.state === 'needs_you').length,
    running: jobs.filter((j) => j.kind !== 'campaign' && j.state === 'running').length,
    notify: tabTitleCount(jobs, seen, now),
  }), [jobs, seen, now]);

  // Tab title: "(N) Dreamlabs Sales" while something needs the user or has just finished.
  useEffect(() => {
    document.title = tabTitle(counts.notify, BASE_TITLE);
    return () => { document.title = BASE_TITLE; };
  }, [counts.notify]);

  const persistSeen = useCallback((next: Set<string>) => {
    setSeen(next);
    if (orgId) writeSeen(storage(), orgId, next);
  }, [orgId]);

  const markFinishedSeen = useCallback(() => {
    const fresh = unseenFinished(jobsRef.current, seen, new Date());
    if (fresh.length === 0) return;
    persistSeen(new Set([...seen, ...fresh.map(seenKey)]));
  }, [seen, persistSeen]);

  const dismiss = useCallback((key: string) => {
    if (seen.has(key)) return;
    persistSeen(new Set([...seen, key]));
  }, [seen, persistSeen]);

  const stop = useCallback(async (jobId: string): Promise<string | null> => {
    const job = jobsRef.current.find((j) => j.id === jobId);
    if (!job || !job.canStop) return 'This job cannot be stopped.';
    let err: string | null = null;
    if (job.kind === 'deep_find') err = await cancelDeepFind(job.sourceId);
    else if (job.kind === 'lookup') {
      const { data, error } = await supabase.functions.invoke('run-lookup-jobs', { body: { action: 'cancel', job_id: job.sourceId } });
      err = error || data?.error ? 'Could not stop this job. Try again.' : null;
    }
    else if (job.kind === 'selected_outreach') {
      const { error } = await supabase.from('autopilot_runs').update({ status: 'cancelled', cancel_reason: 'stopped by user' }).eq('id', job.sourceId).eq('status', 'active');
      err = error ? 'Could not stop this job. Try again.' : null;
    } else err = 'This job cannot be stopped.';
    await load();
    return err;
  }, [load]);

  const remove = useCallback(async (jobId: string): Promise<string | null> => {
    const job = jobsRef.current.find((j) => j.id === jobId);
    const table = job ? JOB_TABLE[job.kind] : undefined;
    if (!job || !table || !job.canDelete) return 'This job cannot be deleted.';
    const { data, error } = await supabase.from(table).delete().eq('id', job.sourceId).select('id');
    if (error) {
      console.error('jobs: delete failed:', error.message);
      if (error.code === '23503') return 'Leads approved from this job are in your pipeline, so it cannot be deleted.';
      return 'Could not delete this job. Try again.';
    }
    if (!data || data.length === 0) {
      // Zero rows: already gone, or not allowed. Look to tell the two apart.
      const { data: still } = await supabase.from(table).select('id').eq('id', job.sourceId).maybeSingle();
      if (still) return 'You are not allowed to delete this job. Only its creator or an organisation admin can.';
    }
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    return null;
  }, []);

  const clearFinished = useCallback(async () => {
    const targets = jobsRef.current.filter((j) => isFinishedState(j.state) && j.canDelete);
    let deleted = 0;
    let failed = 0;
    for (const job of targets) {
      const err = await remove(job.id);
      if (err) failed += 1; else deleted += 1;
    }
    return { deleted, failed };
  }, [remove]);

  const value = useMemo<JobsContextValue>(() => ({
    jobs, groups, failedKinds, loading, now, seen, counts, refresh: load, stop, remove, clearFinished, markFinishedSeen, dismiss,
  }), [jobs, groups, failedKinds, loading, now, seen, counts, load, stop, remove, clearFinished, markFinishedSeen, dismiss]);

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs must be used inside JobsProvider');
  return ctx;
}
