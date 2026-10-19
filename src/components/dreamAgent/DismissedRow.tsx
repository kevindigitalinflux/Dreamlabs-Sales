import { useEffect, useRef } from 'react';
import { Button } from '../ui/Button';

/** Compact state for a dismissed Dream Agent action. The title is struck through AND
 * labelled "Dismissed" so the state never depends on colour alone. Focus moves to
 * Undo on mount (the Dismiss button that had focus is now hidden). */
export function DismissedRow({ title, onUndo }: { title: string; onUndo: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector('button')?.focus(); }, []);
  return (
    <div ref={box} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface/40 px-4 py-2">
      <p className="min-w-0 flex-1 break-words text-sm text-offwhite/80 line-through">{title}</p>
      <span role="status" className="text-xs font-semibold text-offwhite/80">
        <span className="sr-only">Dismissed {title}</span>
        <span aria-hidden>Dismissed</span>
      </span>
      <Button variant="secondary" onClick={onUndo}>Undo</Button>
    </div>
  );
}
