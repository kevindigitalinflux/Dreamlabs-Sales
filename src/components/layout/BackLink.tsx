import { ChevronLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { backTarget } from '../../lib/backTarget';

/** A back arrow above the page for screens reached from another screen. Goes to the previous screen, or to a sensible parent when there is none. */
export function BackLink() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const target = backTarget(pathname);
  if (!target) return null;
  // React Router records the position in the history; 0 means this is the first page of the visit.
  const hasPrevious = (window.history.state as { idx?: number } | null)?.idx ? (window.history.state as { idx: number }).idx > 0 : false;
  return (
    <button
      type="button"
      onClick={() => { if (hasPrevious) navigate(-1); else navigate(target.fallback); }}
      className="mb-3 -ml-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-control px-2 text-sm font-semibold text-muted hover:bg-surface hover:text-offwhite focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-10"
    >
      <ChevronLeft className="h-5 w-5" aria-hidden />
      {target.label}
    </button>
  );
}
