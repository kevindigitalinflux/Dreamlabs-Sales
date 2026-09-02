import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';

export interface OrgApiSetting {
  provider: 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter';
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

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    const { data, error } = await supabase.functions.invoke('org-api-settings', {
      body: { action: 'get', org_id: currentOrg.id },
    });
    if (!error) setSettings((data as { settings: OrgApiSetting[] }).settings);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

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

  return { settings, loading, save, refresh };
}
