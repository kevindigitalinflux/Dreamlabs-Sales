import { useEffect, useState } from 'react';
import { useOrg } from '../../hooks/useOrg';
import { fetchHunterAllowance, hunterAllowanceText, type HunterAllowance } from '../../lib/deepFind';

/**
 * "Hunter: N searches left this month", read through the server from Hunter's free account endpoint. Warns (but does
 * not block) when the searches are used up: the free steps still run.
 */
export function HunterAllowanceLine() {
  const { currentOrg } = useOrg();
  const [state, setState] = useState<{ loading: boolean; allowance: HunterAllowance | null }>({ loading: true, allowance: null });

  useEffect(() => {
    let live = true;
    const orgId = currentOrg?.id;
    if (!orgId) { setState({ loading: false, allowance: null }); return; }
    setState({ loading: true, allowance: null });
    void fetchHunterAllowance(orgId).then((allowance) => { if (live) setState({ loading: false, allowance }); });
    return () => { live = false; };
  }, [currentOrg?.id]);

  if (state.loading) return <p className="text-xs text-muted">Checking Hunter&apos;s searches left this month...</p>;
  const text = hunterAllowanceText(state.allowance);
  if (!text) return <p className="text-xs text-muted">Could not check how many Hunter searches are left.</p>;
  return <p role="status" className={state.allowance?.usedUp ? 'text-xs text-danger' : 'text-xs text-muted'}>{text}</p>;
}
