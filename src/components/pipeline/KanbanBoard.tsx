import { useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { STAGES } from '../../lib/utils';
import { KanbanColumn } from './KanbanColumn';
import { LeadCard } from './LeadCard';
import type { Lead, Stage } from '../../types';

interface KanbanBoardProps {
  leads: Lead[];
  onMove: (id: string, stage: Stage, position: number) => void;
  onOpen: (lead: Lead) => void;
  assigneeNameFor: (lead: Lead) => string | null;
}

function Draggable({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? 'opacity-40' : ''}>
      {children}
    </div>
  );
}

/** Stages that are usually finished with, shown folded to a narrow rail until opened so the working stages fit the screen. */
const FOLDED_BY_DEFAULT: Stage[] = ['won', 'lost', 'not_now_nurture'];

/**
 * Pipeline board that fits the screen: one column per stage across the page width, the board as tall as the window,
 * each column scrolling its own cards, and the finished stages folded to rails. Drag a card onto a column or a rail to change its stage.
 */
export function KanbanBoard({ leads, onMove, onOpen, assigneeNameFor }: KanbanBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [active, setActive] = useState<Lead | null>(null);
  const [opened, setOpened] = useState<Set<Stage>>(new Set());
  const toggle = (stage: Stage) => setOpened((prev) => { const next = new Set(prev); if (next.has(stage)) next.delete(stage); else next.add(stage); return next; });

  function handleDragStart(e: DragStartEvent) {
    setActive(leads.find((l) => l.id === e.active.id) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    const lead = leads.find((l) => l.id === e.active.id);
    const target = e.over?.id as Stage | undefined;
    setActive(null);
    if (!lead || !target || lead.stage === target) return;
    const maxPos = Math.max(0, ...leads.filter((l) => l.stage === target).map((l) => l.kanban_position));
    onMove(lead.id, target, maxPos + 1);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-[calc(100dvh-16rem)] min-h-[420px] gap-2 overflow-x-auto pb-2">
        {STAGES.map((s) => {
          const columnLeads = leads.filter((l) => l.stage === s.value);
          return (
            <KanbanColumn key={s.value} stage={s.value} count={columnLeads.length}
              collapsed={FOLDED_BY_DEFAULT.includes(s.value) && !opened.has(s.value)}
              onToggle={FOLDED_BY_DEFAULT.includes(s.value) ? () => toggle(s.value) : undefined}>
              {columnLeads.map((lead) => (
                <Draggable key={lead.id} id={lead.id}>
                  <LeadCard lead={lead} assigneeName={assigneeNameFor(lead)} onOpen={onOpen} />
                </Draggable>
              ))}
            </KanbanColumn>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {active && <LeadCard lead={active} assigneeName={assigneeNameFor(active)} />}
      </DragOverlay>
    </DndContext>
  );
}
