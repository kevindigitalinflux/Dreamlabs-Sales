import { useEffect, useId, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import { useOrg } from '../../hooks/useOrg';
import { useUsage } from '../../hooks/useUsage';
import { fetchHunterAllowance, hunterAllowanceText, type HunterAllowance } from '../../lib/deepFind';
import {
  chipText, formatRenewalDate, formatResetLine, shortChipText, stateLine, tightestAllowance, usageState, USAGE_TEXT, type UsageState,
} from '../../../supabase/functions/_shared/usageRules';

const CHIP_CLASS: Record<UsageState | 'quiet', string> = {
  // Every state sits on the card colour: amber and red text pass 4.5:1 on it in both themes (on the page background
  // the light theme only reaches 4.1 to 4.2). The calm and loading states use the normal text colour for the same reason.
  ok: 'border-line bg-card text-offwhite',
  warning: 'border-warning bg-card text-warning',
  full: 'border-danger bg-card text-danger',
  shared_full: 'border-danger bg-card text-danger',
  quiet: 'border-line bg-card text-offwhite',
};
const ROW_CLASS: Record<UsageState, string> = { ok: 'text-muted', warning: 'text-warning', full: 'text-danger', shared_full: 'text-danger' };

type HunterState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; value: HunterAllowance | null };

/**
 * Top-bar usage meter. The chip names the allowance closest to running out (in words; colour only reinforces it).
 * The panel lists every allowance with its reset time, opens on hover, keyboard focus and tap, and closes with Escape.
 * Hunter's monthly allowance is fetched once, the first time the panel opens, and only when the organisation has a key.
 */
export function UsageMeter() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const { rows, loading, error } = useUsage(orgId);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [hunter, setHunter] = useState<HunterState>({ status: 'idle' });
  const open = hovered || focused || pinned;

  // Which organisation Hunter was already asked about. A ref (not state) so starting the request does not re-run the
  // effect below and throw the answer away; changing organisation resets it.
  const hunterAskedFor = useRef<string | null>(null);
  useEffect(() => { hunterAskedFor.current = null; setHunter({ status: 'idle' }); }, [orgId]);

  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !orgId || hunterAskedFor.current === orgId) return;
    hunterAskedFor.current = orgId;
    setHunter({ status: 'loading' });
    void fetchHunterAllowance(orgId).then((value) => {
      if (hunterAskedFor.current === orgId) setHunter({ status: 'done', value });
    });
  }, [open, orgId]);

  const tight = tightestAllowance(rows);
  const state: UsageState | 'quiet' = tight ? usageState(tight) : 'quiet';
  const label = loading ? 'Usage…' : error || !tight ? 'Usage unavailable' : chipText(tight);
  const shortLabel = loading ? '…' : error || !tight ? 'Unavailable' : shortChipText(tight);
  const announce =tight && state !== 'ok' && state !== 'quiet' ? chipText(tight) : '';
  const resetsAt = rows[0] ? new Date(rows[0].resetsAt) : null;

  function closeAll() { setHovered(false); setFocused(false); setPinned(false); }

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) { setFocused(false); setPinned(false); } }}
      onKeyDown={(e) => { if (e.key === 'Escape') { closeAll(); (e.target as HTMLElement).blur?.(); } }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}. Show usage details`}
        onClick={() => setPinned((p) => !p)}
        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${CHIP_CLASS[state]}`}
      >
        <Zap className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden whitespace-nowrap sm:inline">{label}</span>
        <span className="whitespace-nowrap sm:hidden">{shortLabel}</span>
      </button>
      <span role="status" className="sr-only">{announce}</span>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Worker usage today"
          className="absolute right-0 top-full z-30 mt-2 w-80 max-w-[90vw] rounded-xl border border-line bg-card p-3 shadow-lg"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Lookup worker, today</p>
          {error || rows.length === 0 ? (
            <p className="text-sm text-muted">Usage could not be loaded right now.</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((row) => {
                const s = usageState(row);
                return (
                  <li key={row.resource} className="flex flex-col gap-0.5 border-t border-line py-2 first:border-t-0 first:pt-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold">{USAGE_TEXT[row.resource].label}</span>
                      <span className={`text-sm font-semibold ${s === 'ok' ? 'text-offwhite' : ROW_CLASS[s]}`}>{row.used} / {row.limit}</span>
                    </div>
                    <p className={`text-xs ${ROW_CLASS[s]}`}>{stateLine(row)}</p>
                  </li>
                );
              })}
            </ul>
          )}
          {resetsAt && !error && <p className="mt-1 border-t border-line pt-2 text-xs text-muted">{formatResetLine(now, resetsAt)}</p>}
          {hunter.status === 'loading' && <p className="mt-2 text-xs text-muted">Checking Hunter…</p>}
          {hunter.status === 'done' && hunter.value?.configured && (
            <p className={`mt-2 text-xs ${hunter.value.usedUp ? 'text-danger' : 'text-muted'}`}>
              {hunterAllowanceText(hunter.value) ?? 'Hunter allowance could not be read.'}
              {formatRenewalDate(hunter.value.resetDate) ? ` Renews ${formatRenewalDate(hunter.value.resetDate)}.` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
