import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { placePopover } from '../../lib/ui/placePopover';

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The control that opened it; the panel is placed against it and focus returns to it on close. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Accessible name of the panel. */
  label: string;
  align?: 'start' | 'end';
  className?: string;
  children: ReactNode;
}

/**
 * Floating panel anchored to a control. Portaled to the body with fixed positioning (the Listbox pattern), so it never
 * changes page layout. Escape, a press outside, scrolling or resizing closes it; focus moves in on open and back on close.
 */
export function Popover({ open, onClose, anchorRef, label, align = 'end', className = '', children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPlace(null); return; }
    const anchor = anchorRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    setPlace(placePopover(anchor, { width: panel.offsetWidth, height: panel.scrollHeight }, { width: window.innerWidth, height: window.innerHeight }, align));
    panelRef.current?.focus();
  }, [open, align, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !anchor?.contains(target)) onClose();
    };
    const onScroll = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onScroll, true);
      anchor?.focus();
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={{ top: place?.top ?? 0, left: place?.left ?? 0, maxHeight: place?.maxHeight, visibility: place ? 'visible' : 'hidden' }}
      className={`fixed z-50 overflow-y-auto rounded-surface border border-line bg-card/90 p-2 shadow-raised outline-none backdrop-blur ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
