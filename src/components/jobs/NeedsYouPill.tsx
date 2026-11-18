import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { X } from 'lucide-react';
import { useJobs } from '../../hooks/useJobs';
import { pillView, type NotifyLine } from '../../lib/jobs/view';
import { Popover } from '../ui/Popover';
import { IconButton } from '../ui/IconButton';

const DOT: Record<NotifyLine['tone'], string> = { needs_you: 'bg-violet', running: 'bg-cyan', finished: 'bg-success' };
const TONE_WORD: Record<NotifyLine['tone'], string> = { needs_you: 'Needs you', running: 'Running', finished: 'Finished' };

/**
 * One pill in the top bar in place of the old multi-row strip: a one-line summary of background jobs. Opening it lists
 * every line (needs you, running, finished) with the same Open, View and Dismiss actions. Renders nothing when there is
 * nothing to say. New lines are announced by JobsAnnouncer, not here.
 */
export function NeedsYouPill() {
  const { jobs, seen, now, dismiss } = useJobs();
  const view = useMemo(() => pillView(jobs, seen, now), [jobs, seen, now]);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  if (!view) return null;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-full border border-line bg-raised px-3 text-sm font-semibold hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-10"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[view.tone]}`} aria-hidden />
        <span className="truncate">{view.text}</span>
      </button>
      <Popover open={open} onClose={close} anchorRef={anchorRef} label="Background jobs" className="w-[min(26rem,calc(100vw-1rem))]">
        <ul className="flex flex-col gap-1">
          {view.lines.map((line) => (
            <li key={line.key} className="flex items-start gap-3 rounded-nested p-2 text-sm hover:bg-surface">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[line.tone]}`} aria-hidden />
              <span className="min-w-0 flex-1 break-words">
                <span className="font-semibold">{TONE_WORD[line.tone]}</span>
                <span className="block text-muted">{line.text}</span>
              </span>
              <Link to={line.href} onClick={close} className="shrink-0 py-1 font-semibold text-link underline">{line.tone === 'needs_you' ? 'Open' : 'View'}</Link>
              {line.dismissible && <IconButton label={`Dismiss: ${line.text}`} icon={X} size="sm" onClick={() => dismiss(line.key)} />}
            </li>
          ))}
        </ul>
        <Link to="/jobs" onClick={close} className="mt-1 block rounded-nested p-2 text-sm font-semibold text-link underline">All jobs</Link>
      </Popover>
    </>
  );
}
