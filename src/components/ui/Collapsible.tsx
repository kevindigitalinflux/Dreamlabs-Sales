import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleProps {
  title: string;
  /** One line saying what is inside while it is closed, e.g. "Phone, email" or "None yet". */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Pass `open` and `onOpenChange` together to control it from outside. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}

/** Folding section: a header with the title, a one-line summary and a chevron; the body opens in place. Remembers nothing. */
export function Collapsible({ title, summary, defaultOpen = false, open, onOpenChange, className = '', children }: CollapsibleProps) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const bodyId = useId();
  const toggle = () => {
    if (open === undefined) setInner(!isOpen);
    onOpenChange?.(!isOpen);
  };
  return (
    <section className={`rounded-nested border border-line ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-nested px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="font-heading text-[15px] font-semibold">{title}</span>
        {summary && !isOpen && <span className="min-w-0 flex-1 truncate text-sm text-muted">{summary}</span>}
        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {isOpen && <div id={bodyId} className="border-t border-line p-3">{children}</div>}
    </section>
  );
}
