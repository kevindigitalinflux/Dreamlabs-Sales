import { useEffect, useMemo, useRef, useState } from 'react';
import { useJobs } from '../../hooks/useJobs';
import { notifyLines, type NotifyLine } from '../../lib/jobs/view';

const TONE_WORD: Record<NotifyLine['tone'], string> = { needs_you: 'Needs you', running: 'Running', finished: 'Finished' };

/**
 * Screen-reader announcement of background jobs, moved unchanged from the old notification bar: a polite live region
 * that announces only newly appearing needs-you and finished lines (never the running progress ticks), from the same
 * top three lines as before. It renders nothing visible; the visible part is the NeedsYouPill in the top bar.
 */
export function JobsAnnouncer() {
  const { jobs, seen, now } = useJobs();
  const { lines } = useMemo(() => notifyLines(jobs, seen, now), [jobs, seen, now]);
  const announcedRef = useRef<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const fresh = lines.filter((l) => l.tone !== 'running' && !announcedRef.current.has(l.key));
    lines.forEach((l) => announcedRef.current.add(l.key));
    if (fresh.length > 0) setAnnouncement(fresh.map((l) => `${TONE_WORD[l.tone]}: ${l.text}`).join('. '));
  }, [lines]);
  return <span role="status" className="sr-only">{announcement}</span>;
}
