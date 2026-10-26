import { readinessText, type Readiness } from '../../../supabase/functions/_shared/leadReadiness';

/** Text carries the full assessment in either theme, including the reason for missing readiness. */
export function ReadinessBadge({ readiness, missing }: { readiness?: Readiness | null; missing?: string[] | null }) {
  return <span className="inline-flex max-w-full whitespace-normal break-words rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold text-offwhite">
    {readinessText(readiness, missing ?? [])}
  </span>;
}
