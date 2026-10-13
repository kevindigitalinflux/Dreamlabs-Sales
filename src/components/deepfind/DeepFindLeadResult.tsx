import { Badge } from '../ui/Badge';
import { DEEP_FIND_STATUS_LABELS, readDeepFindDetails } from '../../lib/deepFindView';
import type { DeepFindRowWithLead } from '../../hooks/useDeepFindRun';
import { DeepFindCompanyChoice } from './DeepFindCompanyChoice';
import { CompanyDomainsEditor } from './CompanyDomainsEditor';

const STATUS_CLASSES: Record<DeepFindRowWithLead['status'], string> = {
  queued: 'bg-surface text-muted',
  running: 'bg-cyan/15 text-cyan',
  done: 'bg-green-500/15 text-success',
  failed: 'bg-red-500/15 text-danger',
  skipped: 'bg-surface text-muted',
};

/**
 * One lead's Deep find result: status, what each step found in plain English, a website warning, the company
 * domains (each removable with "Not their domain"), the Companies House choice when unclear, the people looked up
 * with their role, and the names to check.
 */
export function DeepFindLeadResult({ row }: { row: DeepFindRowWithLead }) {
  const details = readDeepFindDetails(row.domains);
  // Only the officer step waits for this choice; everything else already ran (the row is done).
  const openChoice = details.companyCandidates.length > 0 && !row.lead?.company_number;
  const toCheck = [...details.unverified, ...details.namedByWeb, ...details.namedOnSite];
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.lead?.business_name ?? 'A lead you cannot see'}</span>
        <Badge className={STATUS_CLASSES[row.status]}>{DEEP_FIND_STATUS_LABELS[row.status]}</Badge>
      </div>
      {openChoice && (
        <div className="flex flex-col gap-1 rounded-lg border border-cyan/40 bg-cyan/5 p-2">
          <p className="text-sm font-semibold">Choose the right company</p>
          <p className="text-xs text-muted">
            Deep find carried on with everything else. Only the company&apos;s officers wait for this: once you choose, they are
            added and looked up on the confirmed domains.
          </p>
          <DeepFindCompanyChoice leadId={row.lead_id} candidates={details.companyCandidates} />
        </div>
      )}
      {row.status === 'done' && (
        <p className="text-xs text-muted">{row.people_found === 1 ? '1 person added' : `${row.people_found} people added`}</p>
      )}
      {details.websiteSuspect && (
        <p role="status" className="text-xs text-danger">
          This website may belong to a different company. {details.websiteReasons.join(' ')}
        </p>
      )}
      {details.steps.length > 0 && (
        <ul className="ml-4 list-disc text-xs text-muted">
          {details.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
      <CompanyDomainsEditor leadId={row.lead_id} domains={details.domains} />
      {row.reason && <p className="text-xs">{row.reason}</p>}
      {details.people.length > 0 && (
        <p className="text-xs text-muted">
          People looked up: {details.people.map((p) => `${p.name}${p.role ? ` (${p.role})` : ''}${p.email_found ? ': email found' : ''}`).join(', ')}
        </p>
      )}
      {details.suggestions.length > 0 && (
        <div className="text-xs text-muted">
          <p>Addresses to check (not saved, not used for follow-ups):</p>
          <ul className="ml-4 list-disc">
            {details.suggestions.map((s) => <li key={`${s.name}-${s.value}`}>{s.name}: {s.value} ({s.label})</li>)}
          </ul>
        </div>
      )}
      {toCheck.length > 0 && (
        <p className="text-xs text-muted">To check: {toCheck.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(', ')}</p>
      )}
    </li>
  );
}
