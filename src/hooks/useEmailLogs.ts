import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { EmailLog } from '../types';

/** Sent/draft/failed email log entries, newest first. RLS scopes visibility; admin sees all. */
export function useEmailLogs() {
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('email_logs').select('*').order('sent_at', { ascending: false });
    if (err) setError(err.message);
    else { setLogs(data as EmailLog[]); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { logs, loading, error, refresh };
}
