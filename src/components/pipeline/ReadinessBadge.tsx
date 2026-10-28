import { CheckCircle, AlertTriangle, XCircle, CircleHelp } from 'lucide-react';
import { readinessText, type Readiness } from '../../../supabase/functions/_shared/leadReadiness';

/** Text carries the full assessment in either theme, including the reason for missing readiness. */
export function ReadinessBadge({ readiness, missing }: { readiness?: Readiness | null; missing?: string[] | null }) {
  const Icon = readiness === 'ready' ? CheckCircle : readiness === 'almost' ? AlertTriangle : readiness === 'needs_work' ? XCircle : CircleHelp;
  const tone = readiness === 'ready' ? 'text-stage-won' : readiness === 'almost' ? 'text-stage-proposal-sent' : readiness === 'needs_work' ? 'text-danger-strong' : 'text-stage-new-lead';
  return <span className={`inline-flex items-center gap-1 max-w-full whitespace-normal break-words rounded-md border border-line bg-card px-2 py-1 text-xs font-semibold ${tone}`}>
    <Icon className="h-4 w-4 shrink-0" aria-hidden />
    {readinessText(readiness, missing ?? [])}
  </span>;
}
