import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { Button } from '../ui/Button';
import { chooseDeepFindCompany } from '../../lib/deepFind';
import type { DeepFindCompanyCandidate } from '../../lib/deepFindView';
import { supabase } from '../../lib/supabase';
import { rejectDeepFindCompanies } from '../../lib/deepFindReview';
import { SelectField } from '../ui/Input';
import { logDeepFindError } from '../../lib/deepFindErrors';

/**
 * Companies House returned several possible companies for this lead and Deep find did not guess. The user picks one
 * with "Use this company"; the server checks it, saves it on the lead and adds the company's officers.
 */
export function DeepFindCompanyChoice({ leadId, candidates }: { leadId: string; candidates: DeepFindCompanyCandidate[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const countryChoice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rejecting) countryChoice.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')?.focus();
  }, [rejecting]);
  const [country, setCountry] = useState<'IE' | 'US' | 'OTHER' | 'unlisted'>('IE');

  async function reject() {
    setBusy('reject'); setError(null);
    try { setNotice(await rejectDeepFindCompanies(supabase, leadId, country)); }
    catch (error: unknown) { logDeepFindError('deep find: company rejection could not be saved', error); setError('Could not save this choice. Refresh and try again.'); }
    finally { setBusy(null); }
  }

  if (candidates.length === 0) return null;

  async function choose(number: string) {
    setBusy(number);
    setError(null);
    try {
      const res = await chooseDeepFindCompany(leadId, number);
      if ('error' in res) setError(res.error);
      else setNotice(res.notice ?? 'Saved.');
    } catch (error: unknown) {
      logDeepFindError('deep find: company choice could not be saved', error);
      setError('Could not save this choice. Refresh and try again.');
    } finally { setBusy(null); }
  }

  if (notice) return <p role="status" className="text-sm font-semibold text-success">{notice}</p>;
  return (
    <div className="flex flex-col gap-3 text-offwhite">
      <p className="text-sm font-semibold">Which company is this? Companies House has more than one possible match:</p>
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3">
        <p className="text-[13px]">Not a UK company, or your company is not listed?</p>
        <Button variant="primary" className="w-full whitespace-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet" disabled={busy !== null} aria-expanded={rejecting} onClick={() => setRejecting((open) => !open)}>None of these / not a UK company</Button>
        {rejecting && <div ref={countryChoice} className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface/50 p-3">
          <SelectField label="Where is this company?" value={country} disabled={busy !== null} onChange={(e) => setCountry(e.target.value as typeof country)}>
            <option value="IE">Ireland</option><option value="US">United States</option><option value="OTHER">Other country</option>
            <option value="unlisted">It is a UK company, my company is not listed</option>
          </SelectField>
          <Button variant="secondary" disabled={busy !== null} onClick={() => void reject()}>Save country choice</Button>
        </div>}
      </div>
      <ul className="flex flex-col gap-2">
        {candidates.map((c, index) => {
          const likely = index === 0 && c.status === 'active';
          const reasons = (c.why ?? '').split(/;|\.\s+|\n/).map((r) => r.trim().replace(/\.$/, '')).filter(Boolean);
          return (
            <li key={c.company_number} className={`flex flex-wrap items-center gap-3 rounded-xl p-3 text-sm ${likely ? 'border-2 border-violet bg-card shadow-sm' : 'border border-line bg-card'}`}>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {likely && <span className="inline-flex items-center gap-1 self-start rounded-full bg-violet px-2.5 py-0.5 text-xs font-semibold text-on-accent"><Star size={12} aria-hidden />Most likely — please check the evidence</span>}
                <span className="break-words"><span className="font-semibold">{c.name}</span> ({c.company_number}{c.status ? `, ${c.status}` : ''})</span>
                {c.address && <span className="break-words text-[13px]">{c.address}</span>}
                {reasons.length > 0 && <span className="flex flex-wrap items-center gap-1.5"><span className="text-[13px] font-semibold">Why:</span>{reasons.map((r, i) => <span key={i} className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs">{r}</span>)}</span>}
              </div>
              <Button variant={likely ? 'primary' : 'secondary'} onClick={() => void choose(c.company_number)} loading={busy === c.company_number} disabled={busy !== null || c.status !== 'active'}>
                Use this company
              </Button>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}
