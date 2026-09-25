import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import { usePipeline } from './usePipeline';
import { buildForkedLeadRows } from '../lib/pipelineFork';
import type { Lead, Pipeline, PipelinePermission } from '../types';

/** Create/rename/delete a pipeline you own, and manage its within-org shares. */
export function usePipelineActions() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { refresh } = usePipeline();

  const createPipeline = useCallback(async (name: string): Promise<{ error: string | null; pipeline: Pipeline | null }> => {
    if (!currentOrg) return { error: 'No organization selected', pipeline: null };
    if (!name.trim()) return { error: 'Name is required', pipeline: null };
    const { data, error } = await supabase.from('pipelines')
      .insert({ org_id: currentOrg.id, name: name.trim(), created_by: session?.user.id })
      .select('*').single();
    if (error) return { error: error.message, pipeline: null };
    await refresh();
    return { error: null, pipeline: data as Pipeline };
  }, [currentOrg, session, refresh]);

  const renamePipeline = useCallback(async (pipelineId: string, name: string): Promise<string | null> => {
    if (!name.trim()) return 'Name is required';
    const { error } = await supabase.from('pipelines').update({ name: name.trim() }).eq('id', pipelineId);
    if (error) return error.message;
    await refresh();
    return null;
  }, [refresh]);

  /** Refuses to delete a non-empty pipeline — move or delete its leads first. */
  const deletePipeline = useCallback(async (pipelineId: string): Promise<string | null> => {
    const { count, error: countErr } = await supabase
      .from('leads').select('id', { count: 'exact', head: true }).eq('pipeline_id', pipelineId);
    if (countErr) return countErr.message;
    if ((count ?? 0) > 0) return 'Move or delete every lead in this pipeline before deleting it.';
    const { error } = await supabase.from('pipelines').delete().eq('id', pipelineId);
    if (error) return error.message;
    await refresh();
    return null;
  }, [refresh]);

  /** Within-org only — RLS rejects a target user outside the pipeline's own org. */
  const shareWithinOrg = useCallback(
    async (pipelineId: string, userId: string, permission: PipelinePermission): Promise<string | null> => {
      const { error } = await supabase.from('pipeline_shares').upsert({
        pipeline_id: pipelineId, shared_with_user_id: userId, permission, shared_by: session?.user.id,
      }, { onConflict: 'pipeline_id,shared_with_user_id' });
      if (error) console.error('Failed to share pipeline:', error);
      return error ? 'Could not share this pipeline. Please try again.' : null;
    },
    [session],
  );

  const revokeShare = useCallback(async (shareId: string): Promise<string | null> => {
    const { error } = await supabase.from('pipeline_shares').delete().eq('id', shareId);
    return error ? error.message : null;
  }, []);

  /**
   * Snapshots every lead currently in `source` into a brand-new pipeline owned by
   * the current org — independent from that moment on, per the design spec. Returns
   * the new pipeline so the caller can switch the active pipeline to it.
   */
  const forkPipeline = useCallback(async (source: Pipeline): Promise<{ error: string | null; pipeline: Pipeline | null }> => {
    if (!currentOrg || !session) return { error: 'No organization selected', pipeline: null };
    const { data: sourceLeads, error: leadsErr } = await supabase
      .from('leads').select('*').eq('pipeline_id', source.id);
    if (leadsErr) return { error: leadsErr.message, pipeline: null };
    const { data: newPipeline, error: pipelineErr } = await supabase
      .from('pipelines')
      .insert({ org_id: currentOrg.id, name: `${source.name} (copy)`, created_by: session.user.id })
      .select('*').single();
    if (pipelineErr) return { error: pipelineErr.message, pipeline: null };
    const rows = buildForkedLeadRows(sourceLeads as Lead[], newPipeline.id, currentOrg.id, session.user.id);
    if (rows.length > 0) {
      const { error: insertErr } = await supabase.from('leads').insert(rows);
      if (insertErr) return { error: insertErr.message, pipeline: null };
    }
    await refresh();
    return { error: null, pipeline: newPipeline as Pipeline };
  }, [currentOrg, session, refresh]);

  return { createPipeline, renamePipeline, deletePipeline, shareWithinOrg, revokeShare, forkPipeline };
}
