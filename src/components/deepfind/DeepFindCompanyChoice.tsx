import { useEffect, useRef, useState } from 'react';
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

  if (notice) return <p role="status" className="text-xs text-success">{notice}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold">Which company is this? Companies House has more than one possible match:</p>
      <p className="text-xs">Not a UK company, or your company is not listed?</p>
      <Button variant="primary" className="w-full whitespace-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet" disabled={busy !== null} aria-expanded={rejecting} onClick={() => setRejecting((open) => !open)}>None of these / not a UK company</Button>
      {rejecting && <div ref={countryChoice} className="flex min-w-0 flex-col gap-2 rounded-md border border-line p-2">
        <SelectField label="Where is this company?" value={country} disabled={busy !== null} onChange={(e) => setCountry(e.target.value as typeof country)}>
          <option value="IE">Ireland</option><option value="US">United States</option><option value="OTHER">Other country</option>
          <option value="unlisted">It is a UK company, my company is not listed</option>
        </SelectField>
        <Button variant="secondary" disabled={busy !== null} onClick={() => void reject()}>Save country choice</Button>
      </div>}
      <ul className="flex flex-col gap-1.5">
        {candidates.map((c) => (
          <li key={c.company_number} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface/40 p-2 text-xs">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{c.name}</span> ({c.company_number}{c.status ? `, ${c.status}` : ''})
              {c.address && <span className="block text-muted">{c.address}</span>}
              {c.why && <span className="block text-muted">Why: {c.why}</span>}
            </span>
            <Button variant="secondary" onClick={() => void choose(c.company_number)} loading={busy === c.company_number} disabled={busy !== null}>
              Use this company
            </Button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
