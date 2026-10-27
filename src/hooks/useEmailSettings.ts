import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { EmailProvider, UserEmailSettings } from '../types';
import { useAuth } from './useAuth';

export interface SaveInput {
  provider: EmailProvider;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  from_name: string;
  password: string;
  imap_host?: string;
  imap_port?: number;
}

/** SMTP settings via the email-settings edge function (credentials never touch the client DB API). */
export function useEmailSettings() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const activeUser = useRef(userId); activeUser.current = userId;
  const [owner, setOwner] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserEmailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) { setSettings(null); setOwner(null); setLoading(false); return; }
    try {
    const { data, error: err } = await supabase.functions.invoke('email-settings', { body: { action: 'get' } });
    if (activeUser.current !== userId) return;
    setOwner(userId);
    if (err) setError('Could not load your email settings.');
    else {
      setSettings((data as { settings: UserEmailSettings | null }).settings);
      setError(null);
    }
    setLoading(false);
    } catch { console.error('email settings: status lookup failed'); if (activeUser.current === userId) { setOwner(userId); setError('Could not load your email settings.'); setLoading(false); } }
  }, [userId]);

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

  const testImap = useCallback(async (): Promise<string | null> => {
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('email-settings', { body: { action: 'test_imap' } });
      await refresh();
      return invokeError ? 'Reply detection could not be tested. Check the inbox settings and try again.' : data?.error ?? null;
    } catch { console.error('email settings: inbox test failed'); return 'Reply detection could not be tested. Please try again.'; }
  }, [refresh]);
  return { settings: owner === userId ? settings : null, loading: loading || (!!userId && owner !== userId), error, save, sendTest, testImap, refresh };
}
