import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { X } from 'lucide-react';
import { FOCUSABLE_SELECTOR, trapTarget } from '../../lib/focusTrap';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Optional actions pinned to the dialog's bottom edge, outside the scrolling body. */
  footer?: ReactNode;
}

/**
 * Centered dialog. Closes on Escape, overlay click, or the X button. On open, focus moves to the title; Tab and
 * Shift+Tab stay inside the dialog; on close, focus returns to the control that opened it. An Escape already
 * handled inside (for example by the select listbox) closes only that, not the dialog.
 */
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) onCloseRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  function onDialogKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const dialog = dialogRef.current;
    // Tab inside the select listbox (portalled outside the dialog) is handled by the listbox itself.
    if (e.key !== 'Tab' || e.defaultPrevented || !dialog || !(e.target instanceof Node) || !dialog.contains(e.target)) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const target = trapTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (target === null) return;
    e.preventDefault();
    (target === 'container' ? dialog : items[target]).focus();
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className={footer
          ? 'flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-card outline-none'
          : 'max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-6 outline-none'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={footer ? 'flex shrink-0 items-center justify-between gap-4 px-6 pb-4 pt-6' : 'mb-4 flex items-center justify-between gap-4'}>
          <h3 id={titleId} ref={titleRef} tabIndex={-1} className="text-lg font-bold outline-none">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-offwhite focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-line"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {footer ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">{children}</div>
            <div className="shrink-0 border-t border-line bg-card px-6 py-4">{footer}</div>
          </>
        ) : children}
      </div>
    </div>
  );
}
