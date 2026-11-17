import { Link } from 'react-router';
import { Rocket } from 'lucide-react';
import { useNeedsInputCount } from '../../hooks/useNeedsInputCount';

/** A line on the Dashboard when autopilot has leads waiting for the user; hidden while loading, on error, or when none. */
export function NeedsInputNotice() {
  const { count } = useNeedsInputCount();
  if (!count) return null;
  return (
    <Link to="/outreach/autopilot" className="flex items-center gap-3 rounded-surface border border-line bg-raised shadow-raised p-4 text-sm font-semibold hover:border-violet-line">
      <Rocket className="h-5 w-5 shrink-0 text-link" aria-hidden />
      <span>{count} autopilot {count === 1 ? 'lead needs' : 'leads need'} your input</span>
      <span className="ml-auto text-link">Review</span>
    </Link>
  );
}
