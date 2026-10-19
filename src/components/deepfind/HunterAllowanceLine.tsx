import { useEffect, useState } from 'react';
import { useOrg } from '../../hooks/useOrg';
import { fetchHunterAllowance, hunterAllowanceText, type HunterAllowance } from '../../lib/deepFind';
import { hunterShortfall, hunterAllowanceLeft } from '../../../supabase/functions/_shared/deepFindEffort';

/**
 * "Hunter: N searches left this month", read through the server from Hunter's free account endpoint. Warns (but does
 * not block) when the searches are used up: the free steps still run.
 */
export function HunterAllowanceLine({ requested = 0, onAllowance }: { requested?: number; onAllowance?: (allowance: HunterAllowance | null) => void }) {
  const { currentOrg } = useOrg();
  const [state, setState] = useState<{ loading: boolean; allowance: HunterAllowance | null }>({ loading: true, allowance: null });

  useEffect(() => {
    let live = true;
    const orgId = currentOrg?.id;
    onAllowance?.(null);
    if (!orgId) { setState({ loading: false, allowance: null }); return; }
    setState({ loading: true, allowance: null });
    void fetchHunterAllowance(orgId).then((allowance) => { if (live) { setState({ loading: false, allowance }); onAllowance?.(allowance); } })
      .catch(() => { console.error('deep find: Hunter allowance could not be read'); if (live) { setState({ loading: false, allowance: null }); onAllowance?.(null); } });
    return () => { live = false; };
  }, [currentOrg?.id, onAllowance]);

  if (state.loading) return <p className="text-xs text-muted">Checking Hunter&apos;s searches left this month...</p>;
  const text = hunterAllowanceText(state.allowance);
  if (!text) return <p className="text-xs text-muted">Could not check how many Hunter searches are left.</p>;
  const warning = hunterShortfall(hunterAllowanceLeft(state.allowance), requested);
  return <p role="status" className={state.allowance?.usedUp || warning ? 'text-xs text-danger' : 'text-xs text-muted'}>{text}{warning && <> {warning}</>}</p>;
}
