import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { X } from 'lucide-react';
import { useJobs } from '../../hooks/useJobs';
import { notifyLines, summaryLine, type NotifyLine } from '../../lib/jobs/view';

const DOT: Record<NotifyLine['tone'], string> = { needs_you: 'bg-violet', running: 'bg-cyan', finished: 'bg-success' };
const TONE_WORD: Record<NotifyLine['tone'], string> = { needs_you: 'Needs you', running: 'Running', finished: 'Finished' };

/**
 * Top-of-screen notification bar: what needs the user (cannot be dismissed), what is running, and what just finished
 * (dismissible). At most three lines; one summary line on a phone. Text is always in the normal text colour with a
 * coloured dot, a polite live region announces only newly appearing needs-you and finished lines, it never takes focus,
 * and it adds no animation.
 */
export function JobsBar() {
  const { jobs, seen, now, dismiss } = useJobs();
  const { lines, more } = useMemo(() => notifyLines(jobs, seen, now), [jobs, seen, now]);
  const summary = useMemo(() => summaryLine(jobs, seen, now), [jobs, seen, now]);

  // Announce only lines that were not there before (never the running progress ticks).
  const announcedRef = useRef<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const fresh = lines.filter((l) => l.tone !== 'running' && !announcedRef.current.has(l.key));
    lines.forEach((l) => announcedRef.current.add(l.key));
    if (fresh.length > 0) setAnnouncement(fresh.map((l) => `${TONE_WORD[l.tone]}: ${l.text}`).join('. '));
  }, [lines]);

  return (
    <>
      <span role="status" className="sr-only">{announcement}</span>
      {lines.length > 0 && (
        <div role="region" aria-label="Background jobs" className="border-b border-line bg-card px-4 py-2">
          <ul className="hidden flex-col gap-1 sm:flex">
            {lines.map((line) => (
              <li key={line.key} className="flex items-center gap-3 text-sm">
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[line.tone]}`} aria-hidden />
                <span className="font-semibold">{TONE_WORD[line.tone]}</span>
                <span className="min-w-0 flex-1 truncate">{line.text}</span>
                <Link to={line.href} className="shrink-0 font-semibold underline">{line.tone === 'needs_you' ? 'Open' : 'View'}</Link>
                {line.dismissible && (
                  <button type="button" onClick={() => dismiss(line.key)} aria-label={`Dismiss: ${line.text}`} className="flex min-h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:text-offwhite">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
            {more > 0 && <li className="text-sm text-muted"><Link to="/jobs" className="underline">+{more} more</Link></li>}
          </ul>
          {summary && (
            <Link to="/jobs" className="flex items-center gap-3 text-sm font-semibold sm:hidden">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[lines[0]!.tone]}`} aria-hidden />
              {summary}
              <span className="ml-auto underline">View</span>
            </Link>
          )}
        </div>
      )}
    </>
  );
}
