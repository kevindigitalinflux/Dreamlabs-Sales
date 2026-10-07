import { Link } from 'react-router';
import { Rocket } from 'lucide-react';
import { useNeedsInputCount } from '../../hooks/useNeedsInputCount';

/** A line on the Dashboard when autopilot has leads waiting for the user; hidden while loading, on error, or when none. */
export function NeedsInputNotice() {
  const { count } = useNeedsInputCount();
  if (!count) return null;
  return (
    <Link to="/outreach/autopilot" className="flex items-center gap-3 rounded-xl border border-line bg-card p-4 text-sm font-semibold hover:border-cyan">
      <Rocket className="h-5 w-5 shrink-0 text-cyan" aria-hidden />
      <span>{count} autopilot {count === 1 ? 'lead needs' : 'leads need'} your input</span>
      <span className="ml-auto text-cyan">Review</span>
    </Link>
  );
}
