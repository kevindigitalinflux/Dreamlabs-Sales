import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { stageInfo } from '../../lib/utils';
import { STAGE_BADGE_CLASSES, STAGE_ICONS } from './stageStyles';
import type { Stage } from '../../types';

interface KanbanColumnProps {
  stage: Stage;
  count: number;
  /** Shown as a narrow rail with just the name and count; cards can still be dropped on it. */
  collapsed?: boolean;
  /** When set, the column can be folded to a rail and opened again. */
  onToggle?: () => void;
  children: ReactNode;
}

/** One droppable pipeline column with an icon+colour+label header. Fills the board's height and scrolls its cards inside itself. */
export function KanbanColumn({ stage, count, collapsed = false, onToggle, children }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });
  const Icon = STAGE_ICONS[stage];
  const label = stageInfo(stage).label;
  const fill = isOver ? 'border-violet-line bg-surface' : 'border-line bg-raised';
  if (collapsed) {
    return (
      <section ref={setNodeRef} aria-label={label} className={`flex h-full w-12 shrink-0 flex-col items-center gap-3 rounded-surface border py-2 ${fill}`}>
        <button type="button" onClick={onToggle} aria-label={`Show ${label} (${count})`} title={`Show ${label}`}
          className={`flex min-h-11 w-9 cursor-pointer items-center justify-center rounded-control focus-visible:outline-2 focus-visible:outline-focus ${STAGE_BADGE_CLASSES[stage]}`}>
          <ChevronsRight className="h-4 w-4" aria-hidden />
        </button>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold">{count}</span>
        <span className="flex items-center gap-1 text-sm font-semibold text-muted [writing-mode:vertical-rl]">
          <Icon className="h-4 w-4 rotate-90" aria-hidden />{label}
        </span>
      </section>
    );
  }
  return (
    <section ref={setNodeRef} aria-label={label} className={`flex h-full min-w-[132px] flex-1 flex-col gap-2 rounded-surface border p-2 ${fill}`}>
      <header className={`flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1.5 text-xs font-semibold ${STAGE_BADGE_CLASSES[stage]}`}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        <span className="ml-auto rounded-full bg-navy/25 px-2 py-0.5">{count}</span>
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={`Hide ${label}`} title={`Hide ${label}`} className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-nested hover:bg-navy/25 focus-visible:outline-2 focus-visible:outline-focus">
            <ChevronsLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">{children}</div>
    </section>
  );
}
