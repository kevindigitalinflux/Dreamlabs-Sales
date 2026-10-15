import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';

export interface OrgApiSetting {
  provider: 'gemini' | 'google_places' | 'google_places_pro' | 'companies_house' | 'apollo' | 'hunter' | 'anthropic' | 'opencorporates' | 'cro' | 'lookup_worker';
  is_configured: boolean;
}

/**
 * supabase-js throws a generic `FunctionsHttpError` ("Edge Function returned
 * a non-2xx status code") for every non-2xx response — the actual
 * `{error: "..."}` body our functions send lives on `error.context` (the raw
 * Response), not `error.message`. Without this, real validation messages
 * (e.g. "Gemini rejected the key") never reach the user.
 */
async function extractErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = (await context.json()) as { error?: string };
      if (body.error) return body.error;
    } catch {
      // body wasn't JSON — fall through to the generic message below.
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}

/** BYO API key status for the current org (Gemini/Places/Companies House). Save validates live. */
export function useOrgApiSettings() {
  const { currentOrg } = useOrg();
  const [settings, setSettings] = useState<OrgApiSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [workerHost, setWorkerHost] = useState<string | null>(null);
  const [sharedWorker, setSharedWorker] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOrg, setLoadedOrg] = useState<string | null>(null);
  const activeOrg = useRef(currentOrg?.id);
  activeOrg.current = currentOrg?.id;

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    const { data, error } = await supabase.functions.invoke('org-api-settings', {
      body: { action: 'get', org_id: currentOrg.id },
    });
    if (activeOrg.current !== currentOrg.id) return;
    if (!error && data && !data.error) {
      setSettings((data as { settings: OrgApiSetting[] }).settings);
      setWorkerHost(data.worker_host ?? null);
      setSharedWorker(data.shared_worker_allowed === true);
      setLoadError(null);
    } else setLoadError('Could not load provider settings. Try again.');
    setLoading(false);
    setLoadedOrg(currentOrg.id);
  }, [currentOrg]);

  useEffect(() => {
    activeOrg.current = currentOrg?.id;
    void refresh().catch(() => {
      console.error('settings: provider settings could not be loaded');
      if (activeOrg.current === currentOrg?.id) { setLoadError('Could not load provider settings. Try again.'); setLoading(false); setLoadedOrg(currentOrg?.id ?? null); }
    });
    return () => { activeOrg.current = undefined; };
  }, [refresh, currentOrg?.id]);

  const save = useCallback(async (provider: OrgApiSetting['provider'], apiKey: string): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const { data, error } = await supabase.functions.invoke('org-api-settings', {
      body: { action: 'save', org_id: currentOrg.id, provider, api_key: apiKey },
    });
    if (error) return await extractErrorMessage(error);
    const err = (data as { error?: string }).error;
    if (err) return err;
    await refresh();
    return null;
  }, [currentOrg, refresh]);

  const removeWorker = useCallback(async (): Promise<string | null> => {
    if (!currentOrg) throw new Error('No organization selected');
    const { data, error } = await supabase.functions.invoke('org-api-settings', {
      body: { action: 'remove', org_id: currentOrg.id, provider: 'lookup_worker' },
    });
    if (error) return await extractErrorMessage(error);
    if (data?.error) return data.error as string;
    await refresh();
    return null;
  }, [currentOrg, refresh]);

  const ready = loadedOrg === currentOrg?.id;
  return { settings: ready ? settings : [], loading: loading || !ready, save, refresh,
    workerHost: ready ? workerHost : null, sharedWorker: ready && sharedWorker, removeWorker, loadError: ready ? loadError : null };
}
