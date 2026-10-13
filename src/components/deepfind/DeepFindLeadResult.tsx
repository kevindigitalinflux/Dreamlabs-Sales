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
  const toCheck = [...details.unverified, ...details.namedByWeb, ...details.namedOnSite];
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.lead?.business_name ?? 'A lead you cannot see'}</span>
        <Badge className={STATUS_CLASSES[row.status]}>{DEEP_FIND_STATUS_LABELS[row.status]}</Badge>
      </div>
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
      <DeepFindCompanyChoice leadId={row.lead_id} candidates={details.companyCandidates} />
      {toCheck.length > 0 && (
        <p className="text-xs text-muted">To check: {toCheck.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(', ')}</p>
      )}
    </li>
  );
}
