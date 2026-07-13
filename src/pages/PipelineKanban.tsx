import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Inbox, Plus } from 'lucide-react';
import { useLeads } from '../hooks/useLeads';
import { useProfiles } from '../hooks/useProfiles';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { AddLeadWizard } from '../components/pipeline/AddLeadWizard';
import { KanbanBoard } from '../components/pipeline/KanbanBoard';
import { ViewToggle } from '../components/pipeline/ViewToggle';
import type { Lead, Stage } from '../types';

/** Kanban pipeline page (desktop). Mobile users are pointed to the list view. */
export function PipelineKanban() {
  const { leads, loading, error, createLead, updateLead } = useLeads();
  const { profiles } = useProfiles();
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);

  function assigneeNameFor(lead: Lead): string | null {
    if (!lead.assigned_to) return null;
    const p = profiles.find((x) => x.id === lead.assigned_to);
    return p?.full_name ?? p?.email ?? null;
  }

  function handleMove(id: string, stage: Stage, position: number) {
    void updateLead(id, { stage, kanban_position: position });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Pipeline</h1>
        <div className="flex items-center gap-3">
          <ViewToggle current="kanban" />
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add lead
          </Button>
        </div>
      </div>

      <p className="rounded-lg border border-line bg-card p-4 text-sm text-muted md:hidden">
        The Kanban board works best on desktop. Use the List view here on mobile — your progress is saved.
      </p>

      <div className="hidden md:block">
        {loading && (
          <div className="flex gap-3">
            <Skeleton className="h-72 w-64" />
            <Skeleton className="h-72 w-64" />
            <Skeleton className="h-72 w-64" />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {!loading && !error && leads.length === 0 && (
          <EmptyState
            icon={Inbox}
            title="No leads yet"
            hint="Add your first lead to start working the pipeline."
            action={<Button onClick={() => setWizardOpen(true)}>Add lead</Button>}
          />
        )}
        {!loading && !error && leads.length > 0 && (
          <KanbanBoard
            leads={leads}
            onMove={handleMove}
            onOpen={(lead) => navigate(`/pipeline/leads/${lead.id}`)}
            assigneeNameFor={assigneeNameFor}
          />
        )}
      </div>

      <AddLeadWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={createLead} />
    </div>
  );
}
