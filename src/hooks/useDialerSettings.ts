import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DialerProvider, UserDialerSettings } from '../types';

export interface DialerSaveInput {
  provider: DialerProvider;
  phone_number: string;
  api_key: string;
}

/** Per-contractor dialer connection via the dialer-settings edge function (API key never touches the client DB API). */
export function useDialerSettings() {
  const [settings, setSettings] = useState<UserDialerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.functions.invoke('dialer-settings', { body: { action: 'get' } });
    if (err) setError(err.message);
    else {
      setSettings((data as { settings: UserDialerSettings | null }).settings);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (input: DialerSaveInput): Promise<string | null> => {
    const { data, error: err } = await supabase.functions.invoke('dialer-settings', {
      body: { action: 'save', ...input, api_key: input.api_key || undefined },
    });
    if (err) return err.message;
    const apiErr = (data as { error?: string }).error;
    if (apiErr) return apiErr;
    await refresh();
    return null;
  }, [refresh]);

  return { settings, loading, error, save };
}
