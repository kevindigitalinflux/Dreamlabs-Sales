import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Section heading with the small tinted icon tile used on the folding sections, so headings and folds read as one family. */
export function SectionTitle({ icon: Icon, children, count }: { icon: LucideIcon; children: ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-nested bg-violet/15 text-link"><Icon className="h-4 w-4" aria-hidden /></span>
      <h2 className="font-heading text-[17px] font-semibold">{children}</h2>
      {count !== undefined && <span className="rounded-full bg-surface px-2 py-0.5 text-[13px] font-medium text-muted">{count}</span>}
    </div>
  );
}
