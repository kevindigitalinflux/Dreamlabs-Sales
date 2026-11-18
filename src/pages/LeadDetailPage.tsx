import { useState } from 'react';
import { useParams } from 'react-router';
import { CalendarClock, Contact, FileQuestion, Handshake, Mail, Plus, Send } from 'lucide-react';
import { useLead } from '../hooks/useLead';
import { useLeadNotes } from '../hooks/useLeadNotes';
import { useProfiles } from '../hooks/useProfiles';
import { STAGES, dueLabel, formatCurrency, isOverdue, packageLabel } from '../lib/utils';
import type { Stage } from '../types';
import { Button } from '../components/ui/Button';
import { SelectField } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Collapsible } from '../components/ui/Collapsible';
import { SectionTitle } from '../components/ui/SectionTitle';
import { Tabs, TabPanel } from '../components/ui/Tabs';
import { LeadDetailHeader } from '../components/pipeline/LeadDetailHeader';
import { NextActionEditor } from '../components/pipeline/NextActionEditor';
import { ContactInfo, PipelineInfo } from '../components/pipeline/LeadPanelSections';
import { DecisionMakersCard } from '../components/pipeline/DecisionMakersCard';
import { NotesTimeline } from '../components/pipeline/NotesTimeline';
import { NoteComposer } from '../components/pipeline/NoteComposer';
import { ActivityHistory, CallHistorySection, EmailLogSection } from '../components/pipeline/LeadDetailSections';
import { EmailComposer } from '../components/emails/EmailComposer';
import { EnrollmentControl } from '../components/emails/EnrollmentControl';
import { LeadReplies } from '../components/emails/LeadReplies';
import { PainPointCard } from '../components/pipeline/PainPointCard';
import { DeepFindModal } from '../components/deepfind/DeepFindModal';

/** Full lead record: identity, value and actions on top, then tabs with the detail folded into sections. */
export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { lead, loading, error, updateLead } = useLead(id ?? 'none');
  const { notes, loading: notesLoading, addNote, updateNote, deleteNote } = useLeadNotes(id ?? 'none');
  const { profiles } = useProfiles();
  const [tab, setTab] = useState('overview');
  const [noteOpen, setNoteOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [deepFindOpen, setDeepFindOpen] = useState(false);

  function authorName(userId: string | null): string {
    const p = profiles.find((x) => x.id === userId);
    return p?.full_name ?? p?.email ?? 'Teammate';
  }

  if (loading) return <Skeleton className="h-80 w-full max-w-4xl" />;
  if (error || !lead) {
    return <EmptyState icon={FileQuestion} title="Lead not found" hint="It may have been removed, or you may not have access to it." />;
  }

  const assignee = profiles.find((p) => p.id === lead.assigned_to);
  const save = (patch: Parameters<typeof updateLead>[0]) => updateLead(patch);
  const overdue = isOverdue(lead.next_action_date);
  const contactHint = [lead.phone ? 'Phone' : null, lead.email ? 'Email' : null, lead.website ? 'Website' : null].filter(Boolean).join(', ') || 'None yet';
  const dealHint = [packageLabel(lead.package_tier), lead.deal_value !== null ? formatCurrency(lead.deal_value) : null].filter((x) => x && x !== 'None').join(', ') || 'Nothing set';

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 pb-24 md:pb-4">
      <LeadDetailHeader
        lead={lead}
        assigneeName={assignee ? assignee.full_name ?? assignee.email : null}
        onTogglePriority={() => void updateLead({ is_priority: !lead.is_priority })}
        onEmail={() => setEmailOpen(true)}
        onDeepFind={() => setDeepFindOpen(true)}
        onNote={() => setNoteOpen(true)}
      />

      <Tabs label="Lead sections" value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'contacts', label: 'Contacts' },
        { id: 'notes', label: 'Notes and emails', count: notes.length || undefined },
        { id: 'history', label: 'Calls and activity' },
      ]} />

      <TabPanel id="overview" active={tab === 'overview'}>
        <div className="flex flex-col gap-3">
          <div className={`rounded-surface border border-l-4 border-line p-4 shadow-raised ${overdue ? 'border-l-attention bg-attention-soft' : 'border-l-violet-line bg-raised'}`}>
            <p className="text-[13px] text-muted">Next action</p>
            <b className="block font-heading text-[17px]">{lead.next_action_note ?? 'No next action set'}</b>
            {lead.next_action_date && <span className={`text-sm ${overdue ? 'font-medium text-attention' : 'text-muted'}`}>{dueLabel(lead.next_action_date)}</span>}
          </div>
          <Collapsible icon={CalendarClock} title="Change next action" summary="Date and note"><NextActionEditor lead={lead} onSave={save} /></Collapsible>
          <Collapsible icon={Contact} title="Contact details" summary={contactHint} defaultOpen><ContactInfo lead={lead} onSave={save} /></Collapsible>
          <Collapsible icon={Handshake} title="Deal" summary={dealHint}>
            <div className="flex flex-col gap-4">
              <SelectField label="Stage" value={lead.stage} onChange={(e) => void updateLead({ stage: e.target.value as Stage })}>
                {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </SelectField>
              <PipelineInfo lead={lead} onSave={save} />
            </div>
          </Collapsible>
          <Collapsible icon={Send} title="Follow-up emails" summary="Sequence and pain point">
            <div className="flex flex-col gap-4">
              <EnrollmentControl lead={lead} />
              <PainPointCard leadId={lead.id} icpId={lead.icp_id} refreshKey={notes} />
            </div>
          </Collapsible>
        </div>
      </TabPanel>

      <TabPanel id="contacts" active={tab === 'contacts'}>
        <DecisionMakersCard leadId={lead.id} lead={lead} onSave={save} />
      </TabPanel>

      <TabPanel id="notes" active={tab === 'notes'}>
        <div className="flex flex-col gap-5">
          <LeadReplies leadId={lead.id} />
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle icon={Mail} count={notes.length}>Notes</SectionTitle>
              <Button variant="secondary" onClick={() => setNoteOpen(true)}>Add note</Button>
            </div>
            <NotesTimeline notes={notes} loading={notesLoading} authorName={authorName} onEditNote={updateNote} onDeleteNote={deleteNote} />
          </section>
          <section className="flex flex-col gap-3">
            <SectionTitle icon={Send}>Emails sent</SectionTitle>
            <EmailLogSection leadId={lead.id} />
          </section>
        </div>
      </TabPanel>

      <TabPanel id="history" active={tab === 'history'}>
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-3">
            <SectionTitle icon={Contact}>Calls</SectionTitle>
            <CallHistorySection leadId={lead.id} />
          </section>
          <section className="flex flex-col gap-3">
            <SectionTitle icon={CalendarClock}>Activity</SectionTitle>
            <ActivityHistory notes={notes} loading={notesLoading} />
          </section>
        </div>
      </TabPanel>

      <button
        type="button"
        onClick={() => setNoteOpen(true)}
        aria-label="Add note"
        className="fixed bottom-20 right-4 z-40 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-linear-to-br from-violet to-purple text-on-accent shadow-glow md:hidden"
      >
        <Plus className="h-6 w-6" aria-hidden />
      </button>
      <NoteComposer open={noteOpen} onClose={() => setNoteOpen(false)} lead={lead} addNote={addNote} onUpdateLead={save} />
      <EmailComposer lead={lead} open={emailOpen} onClose={() => setEmailOpen(false)} />
      <DeepFindModal open={deepFindOpen} leadIds={[lead.id]} onClose={() => setDeepFindOpen(false)} />
    </div>
  );
}
