import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import type { Profile, Role } from '../types';

export type OrgProfile = Profile & { role: Role };

interface MembershipRow { role: Role; profiles: Profile }

/** Members of the current org, each annotated with their role WITHIN that org. */
export function useProfiles() {
  const { currentOrg } = useOrg();
  const [profiles, setProfiles] = useState<OrgProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentOrg) { setProfiles([]); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('org_members').select('role, profiles(*)').eq('org_id', currentOrg.id);
    if (err) setError(err.message);
    else {
      const rows = (data as unknown as MembershipRow[]) ?? [];
      setProfiles(rows.map((r) => ({ ...r.profiles, role: r.role })));
      setError(null);
    }
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profiles, loading, error, refresh };
}
