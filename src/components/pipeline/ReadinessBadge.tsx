import { CheckCircle, AlertTriangle, XCircle, CircleHelp } from 'lucide-react';
import { readinessText, type Readiness } from '../../../supabase/functions/_shared/leadReadiness';

/** Text carries the full assessment in either theme, including the reason for missing readiness. */
export function ReadinessBadge({ readiness, missing }: { readiness?: Readiness | null; missing?: string[] | null }) {
  const Icon = readiness === 'ready' ? CheckCircle : readiness === 'almost' ? AlertTriangle : readiness === 'needs_work' ? XCircle : CircleHelp;
  const tone = readiness === 'ready' ? 'text-stage-won bg-stage-won/10 border-stage-won/40' : readiness === 'almost' ? 'text-stage-proposal-sent bg-stage-proposal-sent/10 border-stage-proposal-sent/40' : readiness === 'needs_work' ? 'text-danger-strong bg-danger-strong/10 border-danger-strong/40' : 'text-stage-new-lead bg-stage-new-lead/10 border-stage-new-lead/40';
  return <span className="inline-flex max-w-full rounded-md bg-card"><span className={`inline-flex items-center gap-1 max-w-full whitespace-normal break-words rounded-md border px-2 py-1 text-xs font-semibold ${tone}`}>
    <Icon className="h-4 w-4 shrink-0" aria-hidden />
    {readinessText(readiness, missing ?? [])}
  </span></span>;
}
