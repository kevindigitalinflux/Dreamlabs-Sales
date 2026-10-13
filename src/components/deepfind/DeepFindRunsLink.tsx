import { Link } from 'react-router';
import { Telescope } from 'lucide-react';

/**
 * Pipeline toolbar entry to the Deep find runs page, with a count of finished leads that need the user (a company to
 * choose or people to check). The count comes from the caller's useDeepFindActivity.
 */
export function DeepFindRunsLink({ attention, running }: { attention: number; running: number }) {
  return (
    <Link
      to="/pipeline/deep-find"
      className="relative flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-offwhite hover:bg-surface/70"
    >
      <Telescope className="h-4 w-4" aria-hidden />
      Deep find runs
      {running > 0 && <span className="text-xs font-normal text-muted">({running} running)</span>}
      {attention > 0 && (
        <span className="rounded-full bg-violet px-2 py-0.5 text-xs text-on-accent" aria-label={`${attention} need you`}>{attention}</span>
      )}
    </Link>
  );
}
