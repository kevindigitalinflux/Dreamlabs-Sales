import { Badge } from '../ui/Badge';
import { DEEP_FIND_STATUS_LABELS, readDeepFindDetails } from '../../lib/deepFindView';
import type { DeepFindRowWithLead } from '../../hooks/useDeepFindRun';

const STATUS_CLASSES: Record<DeepFindRowWithLead['status'], string> = {
  queued: 'bg-surface text-muted',
  running: 'bg-cyan/15 text-cyan',
  done: 'bg-green-500/15 text-success',
  failed: 'bg-red-500/15 text-danger',
  skipped: 'bg-surface text-muted',
};

/** One lead's Deep find status: people added, domains discovered, the plain summary and names to check. */
export function DeepFindLeadResult({ row }: { row: DeepFindRowWithLead }) {
  const details = readDeepFindDetails(row.domains);
  const shown = details.domains.filter((d) => !d.needs_check);
  const toCheck = [...details.namedByWeb, ...details.namedOnSite];
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.lead?.business_name ?? 'A lead you cannot see'}</span>
        <Badge className={STATUS_CLASSES[row.status]}>{DEEP_FIND_STATUS_LABELS[row.status]}</Badge>
      </div>
      {row.status === 'done' && (
        <p className="text-xs text-muted">{row.people_found === 1 ? '1 person added' : `${row.people_found} people added`}</p>
      )}
      {shown.length > 0 && <p className="text-xs text-muted">Company domains: {shown.map((d) => d.domain).join(', ')}</p>}
      {row.reason && <p className="text-xs">{row.reason}</p>}
      {toCheck.length > 0 && (
        <p className="text-xs text-muted">To check: {toCheck.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(', ')}</p>
      )}
    </li>
  );
}
