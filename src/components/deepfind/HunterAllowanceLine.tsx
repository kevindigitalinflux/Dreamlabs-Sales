import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
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

  if (state.loading) return <p className="text-[13px] text-offwhite/80">Checking Hunter&apos;s searches left this month...</p>;
  const text = hunterAllowanceText(state.allowance);
  if (!text) return <p className="text-[13px] text-offwhite/80">Could not check how many Hunter searches are left.</p>;
  const warning = hunterShortfall(hunterAllowanceLeft(state.allowance), requested);
  if (!(state.allowance?.usedUp || warning)) return <p role="status" className="text-[13px] text-offwhite/80">{text}</p>;
  return <p role="status" className="flex items-start gap-2 rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-3 text-sm text-offwhite"><AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0" /><span><span className="font-semibold">Allowance warning: </span>{text}{warning && <> {warning}</>}</span></p>;
}
