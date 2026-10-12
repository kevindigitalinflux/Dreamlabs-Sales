import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { activeFormats, insertLink, toggleBold, toggleBullets, toggleHeading, type EditResult } from '../../lib/emailFormatEdit';
import { Textarea } from '../ui/Input';
import { EmailFormatToolbar } from './EmailFormatToolbar';
import { FormattedEmail } from './FormattedEmail';

interface EmailTextEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  /** One line of help under the label area. */
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  /** What the preview shows (e.g. the text with placeholders filled in). Defaults to `value`. */
  previewBody?: string;
  /** Hide the built-in preview when the caller shows its own. */
  showPreview?: boolean;
}

type Selection = { start: number; end: number };

/**
 * An email body box with a formatting toolbar (Bold, Bullets, Heading, Link)
 * under it and a live "How it will look" preview. The textarea ref is
 * forwarded so callers can still insert text at the cursor.
 */
export const EmailTextEditor = forwardRef<HTMLTextAreaElement, EmailTextEditorProps>(function EmailTextEditor(
  { label, value, onChange, rows = 10, hint, placeholder, disabled, error, previewBody, showPreview = true },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement, []);
  const [sel, setSel] = useState<Selection>({ start: 0, end: 0 });
  // The link field takes focus, so remember the textarea's last selection.
  const lastSel = useRef<Selection>({ start: 0, end: 0 });

  const readSelection = useCallback((): Selection => {
    const el = innerRef.current;
    if (el && document.activeElement === el) return { start: el.selectionStart, end: el.selectionEnd };
    return lastSel.current;
  }, []);

  const trackSelection = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    const next = { start: el.selectionStart, end: el.selectionEnd };
    lastSel.current = next;
    setSel(next);
  }, []);

  function apply(edit: (text: string, s: number, e: number) => EditResult) {
    const { start, end } = readSelection();
    const result = edit(value, Math.min(start, value.length), Math.min(end, value.length));
    onChange(result.text);
    const next = { start: result.selStart, end: result.selEnd };
    lastSel.current = next;
    setSel(next);
    requestAnimationFrame(() => {
      const el = innerRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  }

  const active = activeFormats(value, Math.min(sel.start, value.length), Math.min(sel.end, value.length));

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        ref={innerRef}
        label={label}
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        error={error}
        onChange={(e) => { onChange(e.target.value); trackSelection(); }}
        onSelect={trackSelection}
        onKeyUp={trackSelection}
        onClick={trackSelection}
      />
      {hint && <p className="text-xs text-muted">{hint}</p>}
      <EmailFormatToolbar
        active={active}
        disabled={disabled}
        onBold={() => apply(toggleBold)}
        onBullets={() => apply(toggleBullets)}
        onHeading={() => apply(toggleHeading)}
        onLink={(url) => apply((t, s, e) => insertLink(t, s, e, url))}
      />
      {showPreview && (
        <section aria-label="How it will look" className="rounded-lg border border-line bg-surface/40 p-3">
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted"><Eye className="h-3.5 w-3.5" aria-hidden /> How it will look</p>
          <FormattedEmail body={previewBody ?? value} />
        </section>
      )}
    </div>
  );
});
