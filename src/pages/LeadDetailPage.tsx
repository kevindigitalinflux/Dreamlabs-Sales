import { useParams } from 'react-router';
import { FileQuestion, MapPin } from 'lucide-react';
import { useLead } from '../hooks/useLead';
import { useLeadNotes } from '../hooks/useLeadNotes';
import { useProfiles } from '../hooks/useProfiles';
import { STAGES, formatCurrency, initials } from '../lib/utils';
import type { Stage } from '../types';
import { Card } from '../components/ui/Card';
import { SelectField } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { StageBadge } from '../components/pipeline/StageBadge';
import { NextActionEditor } from '../components/pipeline/NextActionEditor';
import { ContactInfo, PipelineInfo } from '../components/pipeline/LeadPanelSections';
import { NotesTimeline } from '../components/pipeline/NotesTimeline';
import { ActivityHistory, EmailLogSection, SequencesSection } from '../components/pipeline/LeadDetailSections';

/** Full lead record (SPEC.md §6 "Lead Detail Page") — 8 sections, vertical scroll. */
export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { lead, loading, error, updateLead } = useLead(id ?? 'none');
  const { notes, loading: notesLoading } = useLeadNotes(id ?? 'none');
  const { profiles } = useProfiles();

  function authorName(userId: string | null): string {
    const p = profiles.find((x) => x.id === userId);
    return p?.full_name ?? p?.email ?? 'Teammate';
  }

  if (loading) return <Skeleton className="h-80 w-full max-w-3xl" />;
  if (error || !lead) {
    return <EmptyState icon={FileQuestion} title="Lead not found" hint="It may have been removed, or you may not have access to it." />;
  }

  const assignedProfile = profiles.find((p) => p.id === lead.assigned_to);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-24 md:pb-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-extrabold">{lead.business_name}</h1>
        <StageBadge stage={lead.stage} />
        {assignedProfile && (
          <span title={assignedProfile.full_name ?? assignedProfile.email} className="flex h-8 w-8 items-center justify-center rounded-full bg-purple text-xs font-bold">
            {initials(assignedProfile.full_name ?? assignedProfile.email)}
          </span>
        )}
        {lead.deal_value !== null && <span className="ml-auto font-heading text-[22px] font-bold text-cyan">{formatCurrency(lead.deal_value)}</span>}
      </header>

      {(lead.address || lead.city || lead.postcode) && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <MapPin className="h-4 w-4" aria-hidden />
          {[lead.address, lead.city, lead.postcode].filter(Boolean).join(', ')}
        </p>
      )}

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Contact</h2>
        <ContactInfo lead={lead} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Pipeline</h2>
        <div className="mb-3">
          <SelectField label="Stage" value={lead.stage} onChange={(e) => void updateLead({ stage: e.target.value as Stage })}>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </SelectField>
        </div>
        <PipelineInfo lead={lead} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Next action</h2>
        <NextActionEditor lead={lead} onSave={(patch) => updateLead(patch)} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Notes</h2>
        <NotesTimeline notes={notes} loading={notesLoading} authorName={authorName} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Emails</h2>
        <EmailLogSection leadId={lead.id} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Sequences</h2>
        <SequencesSection leadId={lead.id} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Activity</h2>
        <ActivityHistory notes={notes} loading={notesLoading} />
      </Card>
    </div>
  );
}
