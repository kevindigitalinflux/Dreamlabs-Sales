import { useState } from 'react';
import { Button } from '../ui/Button';
import { chooseDeepFindCompany } from '../../lib/deepFind';
import type { DeepFindCompanyCandidate } from '../../lib/deepFindView';

/**
 * Companies House returned several possible companies for this lead and Deep find did not guess. The user picks one
 * with "Use this company"; the server checks it, saves it on the lead and adds the company's officers.
 */
export function DeepFindCompanyChoice({ leadId, candidates }: { leadId: string; candidates: DeepFindCompanyCandidate[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  async function choose(number: string) {
    setBusy(number);
    setError(null);
    const res = await chooseDeepFindCompany(leadId, number);
    setBusy(null);
    if ('error' in res) setError(res.error);
    else setNotice(res.notice ?? 'Saved.');
  }

  if (notice) return <p role="status" className="text-xs text-success">{notice}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold">Which company is this? Companies House has more than one possible match:</p>
      <ul className="flex flex-col gap-1.5">
        {candidates.map((c) => (
          <li key={c.company_number} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface/40 p-2 text-xs">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{c.name}</span> ({c.company_number}{c.status ? `, ${c.status}` : ''})
              {c.address && <span className="block text-muted">{c.address}</span>}
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
