import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseGeminiSearchSnapshot, type GeminiSearchSnapshot } from '../../supabase/functions/_shared/geminiSearchMeter';

export interface GeminiUsageState { status: 'idle' | 'loading' | 'done' | 'error'; value: GeminiSearchSnapshot | null }

/** Load informational monthly usage on first open; ignore responses from an old organisation. */
export function useGeminiSearchUsage(orgId: string | null, open: boolean): GeminiUsageState {
  const requested = useRef<string | null>(null);
  const currentOrg = useRef(orgId); currentOrg.current = orgId;
  const [state, setState] = useState<GeminiUsageState & { orgId: string | null }>({ orgId: null, status: 'idle', value: null });
  useEffect(() => {
    if (!open || !orgId || requested.current === orgId) return;
    requested.current = orgId;
    setState({ orgId, status: 'loading', value: null });
    void Promise.resolve(supabase.rpc('gemini_search_snapshot', { p_org: orgId })).then(result => {
      if (currentOrg.current !== orgId) return;
      const value = result.error ? null : parseGeminiSearchSnapshot(result.data);
      setState({ orgId, status: value ? 'done' : 'error', value });
    }).catch(() => {
      console.error('gemini_search_snapshot_failed');
      if (currentOrg.current === orgId) setState({ orgId, status: 'error', value: null });
    });
  }, [orgId, open]);
  return state.orgId === orgId ? state : { status: 'idle', value: null };
}
