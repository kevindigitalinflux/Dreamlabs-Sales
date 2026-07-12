import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

/** All profiles visible to the current user (RLS: admins see everyone, contractors see themselves). */
export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.from('profiles').select('*').order('created_at');
    if (err) setError(err.message);
    else {
      setProfiles(data as Profile[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profiles, loading, error, refresh };
}
