import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { EmailProvider, UserEmailSettings } from '../types';

export interface SaveInput {
  provider: EmailProvider;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  from_name: string;
  password: string;
}

/** SMTP settings via the email-settings edge function (credentials never touch the client DB API). */
export function useEmailSettings() {
  const [settings, setSettings] = useState<UserEmailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.functions.invoke('email-settings', { body: { action: 'get' } });
    if (err) setError(err.message);
    else {
      setSettings((data as { settings: UserEmailSettings | null }).settings);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (input: SaveInput): Promise<string | null> => {
    const { data, error: err } = await supabase.functions.invoke('email-settings', {
      body: { action: 'save', ...input, password: input.password || undefined },
    });
    if (err) return err.message;
    const apiErr = (data as { error?: string }).error;
    if (apiErr) return apiErr;
    await refresh();
    return null;
  }, [refresh]);

  const sendTest = useCallback(async (): Promise<string | null> => {
    const { data, error: err } = await supabase.functions.invoke('email-settings', { body: { action: 'test' } });
    if (err) return err.message;
    const apiErr = (data as { error?: string }).error;
    if (apiErr) return apiErr;
    await refresh();
    return null;
  }, [refresh]);

  return { settings, loading, error, save, sendTest };
}
