import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { Pipeline, PipelinePermission } from '../types';

export interface OutgoingShare {
  id: string;
  pipeline_id: string;
  permission: PipelinePermission;
  profiles: { id: string; full_name: string | null; email: string };
}

export interface IncomingShare {
  id: string;
  permission: PipelinePermission;
  pipelines: Pipeline;
}

/** Shares on pipelines the user owns (outgoing, grouped by pipeline) and shares
 * granted to the user (incoming, any org). */
export function usePipelineShares(ownedPipelineIds: string[]) {
  const { session } = useAuth();
  const [outgoing, setOutgoing] = useState<Record<string, OutgoingShare[]>>({});
  const [incoming, setIncoming] = useState<IncomingShare[]>([]);
  const [loading, setLoading] = useState(true);
  const idsKey = ownedPipelineIds.join(',');

  const refresh = useCallback(async () => {
    if (!session) { setOutgoing({}); setIncoming([]); setLoading(false); return; }
    const ids = idsKey ? idsKey.split(',') : [];
    const [outRes, inRes] = await Promise.all([
      ids.length > 0
        ? supabase
            .from('pipeline_shares')
            .select('id, pipeline_id, permission, profiles!pipeline_shares_shared_with_user_id_fkey(id, full_name, email)')
            .in('pipeline_id', ids)
        : Promise.resolve({ data: [] as unknown[], error: null }),
      supabase.from('pipeline_shares').select('id, permission, pipelines(*)').eq('shared_with_user_id', session.user.id),
    ]);
    if (!outRes.error) {
      const grouped: Record<string, OutgoingShare[]> = {};
      for (const row of (outRes.data as unknown as OutgoingShare[]) ?? []) {
        (grouped[row.pipeline_id] ??= []).push(row);
      }
      setOutgoing(grouped);
    }
    if (!inRes.error) setIncoming((inRes.data as unknown as IncomingShare[]) ?? []);
    setLoading(false);
  }, [session, idsKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { outgoing, incoming, loading, refresh };
}
