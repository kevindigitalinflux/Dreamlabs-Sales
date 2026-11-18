import { CheckCircle, AlertTriangle, XCircle, CircleHelp } from 'lucide-react';
import { readinessText, type Readiness } from '../../../supabase/functions/_shared/leadReadiness';

const SHORT = { ready: 'Ready', almost: 'Almost', needs_work: 'Needs work' } as const;

export function ReadinessBadge({ readiness, missing, compact = false }: { readiness?: Readiness | null; missing?: string[] | null; compact?: boolean }) {
  const full = readinessText(readiness, missing ?? []);
  if (compact) {
    const Icon = readiness === 'ready' ? CheckCircle : readiness === 'almost' ? AlertTriangle : readiness === 'needs_work' ? XCircle : CircleHelp;
    const tone = readiness === 'ready' ? 'text-stage-won bg-stage-won/10' : readiness === 'almost' ? 'text-stage-proposal-sent bg-stage-proposal-sent/10' : readiness === 'needs_work' ? 'text-stage-negotiating bg-stage-negotiating/10' : 'text-muted bg-surface';
    return <span title={full} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium ${tone}`}><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="sr-only">{full}</span><span aria-hidden>{readiness ? SHORT[readiness] : 'Not checked'}</span></span>;
  }
  const Icon = readiness === 'ready' ? CheckCircle : readiness === 'almost' ? AlertTriangle : readiness === 'needs_work' ? XCircle : CircleHelp;
  const tone = readiness === 'ready' ? 'text-stage-won bg-stage-won/10 border-stage-won/40' : readiness === 'almost' ? 'text-stage-proposal-sent bg-stage-proposal-sent/10 border-stage-proposal-sent/40' : readiness === 'needs_work' ? 'text-danger-strong bg-danger-strong/10 border-danger-strong/40' : 'text-stage-new-lead bg-stage-new-lead/10 border-stage-new-lead/40';
  return <span className="inline-flex max-w-full rounded-nested bg-card"><span className={`inline-flex items-center gap-1 max-w-full whitespace-normal break-words rounded-nested border px-2 py-1 text-xs font-semibold ${tone}`}>
    <Icon className="h-4 w-4 shrink-0" aria-hidden />
    {readinessText(readiness, missing ?? [])}
  </span></span>;
}
