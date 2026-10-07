import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const CHUNK = 100;

/** Loads current statuses for email log ids (RLS-scoped, batched). Ids missing from the result no longer exist. */
export async function fetchLogStatuses(ids: string[]): Promise<{ statuses: Map<string, string>; error: string | null }> {
  const statuses = new Map<string, string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from('email_logs').select('id, status').in('id', ids.slice(i, i + CHUNK));
    if (error) return { statuses, error: error.message };
    for (const r of (data as { id: string; status: string }[] | null) ?? []) statuses.set(r.id, r.status);
  }
  return { statuses, error: null };
}

/**
 * Current status of the given email logs, so parked autopilot drafts can be shown as sent or discarded.
 * Late responses for an earlier id list are ignored. `ready` is false until a load for the current id set has finished; a refresh keeps the previous result visible.
 */
export function useDraftStatuses(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',');
  const [statuses, setStatuses] = useState<Map<string, string>>(new Map());
  const [loadedKey, setLoadedKey] = useState<string | null>(key === '' ? '' : null);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  const refresh = useCallback(async () => {
    const token = ++tokenRef.current;
    if (key === '') { setStatuses(new Map()); setLoadedKey(''); setError(null); return; }
    const result = await fetchLogStatuses(key.split(','));
    if (token !== tokenRef.current) return;
    if (result.error) setError(result.error);
    else { setStatuses(result.statuses); setError(null); }
    setLoadedKey(key);
  }, [key]);

  useEffect(() => {
    void refresh();
    return () => { tokenRef.current += 1; };
  }, [key, refresh]);

  return { statuses, ready: loadedKey === key, error, refresh };
}
