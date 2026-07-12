import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useLeads } from '../hooks/useLeads';
import { Button } from '../components/ui/Button';
import { AddLeadWizard } from '../components/pipeline/AddLeadWizard';

/** Kanban pipeline view — board arrives in Task 10; Add-lead works now. */
export function PipelineKanban() {
  const { leads, createLead } = useLeads();
  const [wizardOpen, setWizardOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-extrabold">Pipeline</h1>
        <Button onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          Add lead
        </Button>
      </div>
      <p className="text-muted">{leads.length} lead(s) — Kanban board coming in Task 10.</p>
      <AddLeadWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={createLead} />
    </div>
  );
}
