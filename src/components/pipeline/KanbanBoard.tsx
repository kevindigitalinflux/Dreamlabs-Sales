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

/** 8-column pipeline board; drag a card onto another column to change its stage. */
export function KanbanBoard({ leads, onMove, onOpen, assigneeNameFor }: KanbanBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [active, setActive] = useState<Lead | null>(null);

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
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((s) => {
          const columnLeads = leads.filter((l) => l.stage === s.value);
          return (
            <KanbanColumn key={s.value} stage={s.value} count={columnLeads.length}>
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
