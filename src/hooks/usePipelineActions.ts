import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import { usePipeline } from './usePipeline';
import type { PipelinePermission } from '../types';

/** Create/rename/delete a pipeline you own, and manage its within-org shares. */
export function usePipelineActions() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { refresh } = usePipeline();

  const createPipeline = useCallback(async (name: string): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    if (!name.trim()) return 'Name is required';
    const { error } = await supabase.from('pipelines').insert({
      org_id: currentOrg.id, name: name.trim(), created_by: session?.user.id,
    });
    if (error) return error.message;
    await refresh();
    return null;
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
      const { error } = await supabase.from('pipeline_shares').insert({
        pipeline_id: pipelineId, shared_with_user_id: userId, permission, shared_by: session?.user.id,
      });
      return error ? error.message : null;
    },
    [session],
  );

  const revokeShare = useCallback(async (shareId: string): Promise<string | null> => {
    const { error } = await supabase.from('pipeline_shares').delete().eq('id', shareId);
    return error ? error.message : null;
  }, []);

  return { createPipeline, renamePipeline, deletePipeline, shareWithinOrg, revokeShare };
}
