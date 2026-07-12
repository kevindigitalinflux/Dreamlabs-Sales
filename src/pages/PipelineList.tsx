import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useLeads } from '../hooks/useLeads';
import { Button } from '../components/ui/Button';
import { AddLeadWizard } from '../components/pipeline/AddLeadWizard';

/** List pipeline view — list arrives in Task 12; Add-lead works now. */
export function PipelineList() {
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
      <p className="text-muted">{leads.length} lead(s) — List view coming in Task 12.</p>
      <AddLeadWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={createLead} />
    </div>
  );
}
