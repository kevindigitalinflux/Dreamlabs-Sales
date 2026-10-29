import { useId, useState } from 'react';
import { isLongNote } from '../../lib/noteSummary';

/** Note text that wraps inside its box; long notes show their first lines with a toggle. */
export function NoteText({ content, compact = false }: { content: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const long = isLongNote(content, compact);
  return (
    <div className="min-w-0">
      <p id={id} className={`whitespace-pre-wrap break-words text-sm ${long && !open ? (compact ? 'line-clamp-3' : 'line-clamp-6') : ''}`}>{content}</p>
      {long && (
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
          className="mt-1 flex min-h-8 cursor-pointer items-center text-xs font-semibold text-cyan hover:underline">
          {open ? 'Show less' : 'Show full note'}
        </button>
      )}
    </div>
  );
}
