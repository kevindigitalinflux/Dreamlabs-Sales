import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { stageInfo } from '../../lib/utils';
import { STAGE_BADGE_CLASSES, STAGE_ICONS } from './stageStyles';
import type { Stage } from '../../types';

interface KanbanColumnProps {
  stage: Stage;
  count: number;
  children: ReactNode;
}

/** One droppable pipeline column with an icon+colour+label header. */
export function KanbanColumn({ stage, count, children }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });
  const Icon = STAGE_ICONS[stage];
  return (
    <section
      ref={setNodeRef}
      aria-label={stageInfo(stage).label}
      className={`flex w-64 shrink-0 flex-col gap-2 rounded-xl border p-2 ${isOver ? 'border-cyan bg-surface/50' : 'border-line bg-navy/30'}`}
    >
      <header className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold ${STAGE_BADGE_CLASSES[stage]}`}>
        <Icon className="h-4 w-4" aria-hidden />
        {stageInfo(stage).label}
        <span className="ml-auto rounded-full bg-black/25 px-2 py-0.5">{count}</span>
      </header>
      <div className="flex min-h-24 flex-col gap-2 overflow-y-auto">{children}</div>
    </section>
  );
}
