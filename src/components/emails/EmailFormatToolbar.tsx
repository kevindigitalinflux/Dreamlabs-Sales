import { useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Bold, Heading, Link2, List } from 'lucide-react';
import { normaliseLinkUrl } from '../../lib/emailFormatEdit';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

export interface ActiveFormats {
  bold: boolean;
  bullets: boolean;
  heading: boolean;
}

interface EmailFormatToolbarProps {
  active: ActiveFormats;
  onBold: () => void;
  onBullets: () => void;
  onHeading: () => void;
  /** Called with a cleaned, safe http(s) address. */
  onLink: (url: string) => void;
  disabled?: boolean;
}

/** Keeps the textarea's selection: a toolbar press must not take focus away from it. */
const keepSelection = (e: MouseEvent) => e.preventDefault();

function ToolButton({ label, icon, pressed, onClick, disabled }: { label: string; icon: ReactNode; pressed?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={onClick}
      className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${
        pressed ? 'border-violet bg-violet/15 text-offwhite' : 'border-line bg-surface text-muted hover:text-offwhite'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Bold / Bullets / Heading / Link buttons shown under an email text box. Each
 * button applies or removes the formatting on the selected text; Link opens a
 * small address field.
 */
export function EmailFormatToolbar({ active, onBold, onBullets, onHeading, onLink, disabled }: EmailFormatToolbarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  function addLink() {
    const clean = normaliseLinkUrl(url);
    if (!clean) { setError('Enter a valid web address, like https://example.com'); return; }
    onLink(clean);
    setUrl('');
    setError(null);
    setLinkOpen(false);
  }

  function cancel() {
    setUrl('');
    setError(null);
    setLinkOpen(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-2">
        <ToolButton label="Bold" icon={<Bold className="h-4 w-4" aria-hidden />} pressed={active.bold} onClick={onBold} disabled={disabled} />
        <ToolButton label="Bullets" icon={<List className="h-4 w-4" aria-hidden />} pressed={active.bullets} onClick={onBullets} disabled={disabled} />
        <ToolButton label="Heading" icon={<Heading className="h-4 w-4" aria-hidden />} pressed={active.heading} onClick={onHeading} disabled={disabled} />
        <ToolButton label="Link" icon={<Link2 className="h-4 w-4" aria-hidden />} pressed={linkOpen} onClick={() => setLinkOpen((o) => !o)} disabled={disabled} />
      </div>
      {linkOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-2 sm:flex-row sm:items-end">
          <Input
            label="Link address"
            value={url}
            autoFocus
            placeholder="https://"
            error={error ?? undefined}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addLink(); }
              if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={addLink} disabled={!url.trim()}>Add</Button>
            <Button variant="ghost" onClick={cancel}>Cancel</Button>
          </div>
        </div>
      )}
      <p className="text-xs text-muted">Select text, then press a button. The preview shows how it will look in the email.</p>
    </div>
  );
}
