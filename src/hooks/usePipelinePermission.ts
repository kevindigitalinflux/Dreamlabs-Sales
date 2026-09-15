import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { PipelinePermission } from '../types';

/** The current user's own share permission on a pipeline, or null if they own it,
 * it's a default pipeline, or they have no explicit share at all. */
export function usePipelinePermission(pipelineId: string | null): PipelinePermission | null {
  const { session } = useAuth();
  const [permission, setPermission] = useState<PipelinePermission | null>(null);

  useEffect(() => {
    if (!pipelineId || !session) { setPermission(null); return; }
    let cancelled = false;
    void supabase
      .from('pipeline_shares').select('permission')
      .eq('pipeline_id', pipelineId).eq('shared_with_user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPermission((data?.permission as PipelinePermission | undefined) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [pipelineId, session]);

  return permission;
}
