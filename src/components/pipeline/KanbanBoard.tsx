import { useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { STAGES } from '../../lib/utils';
import { Button } from '../ui/Button';
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
  const [folded, setFolded] = useState<Set<Stage>>(new Set(FOLDED_BY_DEFAULT));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function flip<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  }
  const allCardsOpen = leads.length > 0 && leads.every((l) => expanded.has(l.id));

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
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setExpanded(allCardsOpen ? new Set() : new Set(leads.map((l) => l.id)))}>
          {allCardsOpen ? 'Collapse all cards' : 'Expand all cards'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setFolded(folded.size > 0 ? new Set() : new Set(STAGES.map((s) => s.value)))}>
          {folded.size > 0 ? 'Open all columns' : 'Fold all columns'}
        </Button>
      </div>
      <div className="flex h-[calc(100dvh-12.5rem)] min-h-[460px] gap-2 overflow-x-auto pb-2">
        {STAGES.map((s) => {
          const columnLeads = leads.filter((l) => l.stage === s.value);
          return (
            <KanbanColumn key={s.value} stage={s.value} count={columnLeads.length}
              collapsed={folded.has(s.value)}
              onToggle={() => setFolded((prev) => flip(prev, s.value))}>
              {columnLeads.map((lead) => (
                <Draggable key={lead.id} id={lead.id}>
                  <LeadCard lead={lead} assigneeName={assigneeNameFor(lead)} onOpen={onOpen} expanded={expanded.has(lead.id)} onToggleExpanded={() => setExpanded((prev) => flip(prev, lead.id))} />
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
