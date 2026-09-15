import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import type { Pipeline } from '../types';

interface PipelineContextValue {
  currentPipeline: Pipeline | null;
  pipelines: Pipeline[];
  loading: boolean;
  switchPipeline: (pipelineId: string) => void;
  refresh: () => Promise<void>;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

/**
 * Every pipeline visible to the user — owned or default in the current org, plus
 * anything shared with them from any org (RLS returns exactly this set for a plain
 * `select('*')`, no org filter needed client-side) — and which one is active.
 */
export function PipelineProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [currentPipelineId, setCurrentPipelineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session || !currentOrg) { setPipelines([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('pipelines').select('*').order('is_default', { ascending: false }).order('name');
    if (error) { setLoading(false); return; }
    const rows = data as Pipeline[];
    setPipelines(rows);
    setCurrentPipelineId((current) => {
      if (current && rows.some((p) => p.id === current)) return current;
      const saved = localStorage.getItem('current-pipeline');
      const restored = rows.find((p) => p.id === saved && p.org_id === currentOrg.id);
      const fallback = rows.find((p) => p.org_id === currentOrg.id && p.is_default) ?? rows[0] ?? null;
      return (restored ?? fallback)?.id ?? null;
    });
    setLoading(false);
  }, [session, currentOrg]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchPipeline = useCallback((pipelineId: string) => {
    localStorage.setItem('current-pipeline', pipelineId);
    setCurrentPipelineId(pipelineId);
  }, []);

  const currentPipeline = pipelines.find((p) => p.id === currentPipelineId) ?? null;

  return (
    <PipelineContext.Provider value={{ currentPipeline, pipelines, loading, switchPipeline, refresh }}>
      {children}
    </PipelineContext.Provider>
  );
}

/** Access the current pipeline context; must be used inside PipelineProvider. */
export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error('usePipeline must be used inside PipelineProvider');
  return ctx;
}
