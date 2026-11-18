import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface CollapsibleProps {
  title: string;
  /** One line saying what is inside while it is closed, e.g. "Phone, email" or "None yet". */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Pass `open` and `onOpenChange` together to control it from outside. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** Small accent icon in a tinted tile before the title. */
  icon?: LucideIcon;
  /** Use inside a card or panel: a plain outline with no lift, so it does not look like a box in a box. */
  flat?: boolean;
  children: ReactNode;
}

/** Folding section: a header with the title, a one-line summary and a chevron; the body opens in place. Remembers nothing. */
export function Collapsible({ title, summary, defaultOpen = false, open, onOpenChange, className = '', icon: Icon, flat = false, children }: CollapsibleProps) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const bodyId = useId();
  const toggle = () => {
    if (open === undefined) setInner(!isOpen);
    onOpenChange?.(!isOpen);
  };
  return (
    <section className={`border border-line ${flat ? 'rounded-nested' : 'rounded-surface bg-raised shadow-raised'} ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className={`flex w-full cursor-pointer items-center gap-3 text-left ${flat ? 'min-h-11 rounded-nested px-3' : 'min-h-14 rounded-surface px-4'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
      >
        {Icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-nested bg-violet-soft text-link"><Icon className="h-4 w-4" aria-hidden /></span>}
        <span className="font-heading text-[15px] font-semibold">{title}</span>
        {summary && !isOpen && <span className="min-w-0 flex-1 truncate text-sm text-muted">{summary}</span>}
        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {isOpen && <div id={bodyId} className={`border-t border-line ${flat ? 'p-3' : 'p-4'}`}>{children}</div>}
    </section>
  );
}
