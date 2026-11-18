import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { stageInfo } from '../../lib/utils';
import { STAGE_BADGE_CLASSES, STAGE_BORDER_CLASSES, STAGE_ICONS } from './stageStyles';
import type { Stage } from '../../types';

interface KanbanColumnProps {
  stage: Stage;
  count: number;
  /** Folded to a narrow rail with the stage name written up the side; cards can still be dropped on it. */
  collapsed?: boolean;
  /** Folds or opens the column. */
  onToggle: () => void;
  children: ReactNode;
}

/** One droppable pipeline column with an icon, colour and label header. Fills the board's height and scrolls its cards inside itself. */
export function KanbanColumn({ stage, count, collapsed = false, onToggle, children }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });
  const Icon = STAGE_ICONS[stage];
  const label = stageInfo(stage).label;
  const fill = isOver ? 'border-violet-line bg-surface' : 'border-line bg-raised';
  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        aria-label={label}
        className={`flex h-full w-14 shrink-0 flex-col items-center gap-3 rounded-surface border border-t-4 py-2 ${fill} ${STAGE_BORDER_CLASSES[stage].replace('border-l-', 'border-t-')}`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Open ${label} (${count} leads)`}
          title={`Open ${label}`}
          className="flex min-h-11 w-10 cursor-pointer items-center justify-center rounded-control text-offwhite hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus"
        >
          <ChevronsRight className="h-5 w-5" aria-hidden />
        </button>
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-sm font-bold">{count}</span>
        <span aria-hidden className="pb-2 font-heading text-[15px] font-semibold text-offwhite [writing-mode:vertical-rl]">{label}</span>
      </section>
    );
  }
  return (
    <section ref={setNodeRef} aria-label={label} className={`flex h-full min-w-[168px] flex-1 flex-col gap-2 rounded-surface border p-2 ${fill}`}>
      <header className={`flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1.5 text-xs font-semibold ${STAGE_BADGE_CLASSES[stage]}`}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        <span className="ml-auto rounded-full bg-navy/25 px-2 py-0.5">{count}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Fold ${label}`}
          title={`Fold ${label}`}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-nested hover:bg-navy/25 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <ChevronsLeft className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">{children}</div>
    </section>
  );
}
