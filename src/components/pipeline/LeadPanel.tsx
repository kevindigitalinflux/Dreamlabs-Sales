import { useState } from 'react';
import type { LeadPatch } from '../../lib/leadUpdates';
import { useLeadNotes } from '../../hooks/useLeadNotes';
import { useOrg } from '../../hooks/useOrg';
import type { OrgProfile } from '../../hooks/useProfiles';
import type { Lead } from '../../types';
import { Button } from '../ui/Button';
import { Tabs, TabPanel } from '../ui/Tabs';
import { DeepFindModal } from '../deepfind/DeepFindModal';
import { LeadPanelHeader } from './LeadPanelHeader';
import { LeadPanelOverview } from './LeadPanelOverview';
import { NotesPreview } from './LeadPanelSections';
import { NoteComposer } from './NoteComposer';
import { DecisionMakersCard } from './DecisionMakersCard';
import { EmailComposer } from '../emails/EmailComposer';

interface LeadPanelProps {
  lead: Lead | null;
  profiles: OrgProfile[];
  onClose: () => void;
  onUpdate: (id: string, patch: LeadPatch) => Promise<string | null>;
}

/**
 * The lead record: a full-height panel fixed to the right edge. Summary and the three main actions on top, then three
 * tabs (Overview, Contacts, Notes and emails) with the detail folded away. Renders nothing when no lead is selected.
 */
export function LeadPanel({ lead, profiles, onClose, onUpdate }: LeadPanelProps) {
  const { currentOrg } = useOrg();
  const [tab, setTab] = useState('overview');
  const [noteOpen, setNoteOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [deepFindOpen, setDeepFindOpen] = useState(false);
  const { notes, loading: notesLoading, addNote, updateNote, deleteNote } = useLeadNotes(lead?.id ?? 'none');

  if (!lead) return null;
  const save = (patch: LeadPatch) => onUpdate(lead.id, patch);
  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-navy/40" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={lead.business_name}
        className="absolute inset-y-0 right-0 flex w-full max-w-[430px] flex-col border-l border-line bg-card shadow-[-24px_0_48px_-24px_rgba(2,6,40,0.6)] motion-safe:animate-[slidein_.15s_ease-out]"
      >
        <div className="h-1.5 shrink-0 bg-violet" aria-hidden />
        <LeadPanelHeader lead={lead} onClose={onClose} onUpdate={onUpdate} onEmail={() => setEmailOpen(true)} onDeepFind={() => setDeepFindOpen(true)} />
        <div className="shrink-0 px-6">
          <Tabs label="Lead sections" value={tab} onChange={setTab} tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'contacts', label: 'Contacts' },
            { id: 'notes', label: 'Notes and emails', count: notes.length || undefined },
          ]} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <TabPanel id="overview" active={tab === 'overview'}>
            <LeadPanelOverview lead={lead} profiles={profiles} isAdmin={currentOrg?.role === 'admin'} notesKey={notes} onSave={save} />
          </TabPanel>
          <TabPanel id="contacts" active={tab === 'contacts'}>
            <DecisionMakersCard leadId={lead.id} lead={lead} onSave={save} />
          </TabPanel>
          <TabPanel id="notes" active={tab === 'notes'}>
            <div className="flex flex-col gap-4">
              <Button variant="secondary" className="self-start" onClick={() => setNoteOpen(true)}>Log note</Button>
              <NotesPreview notes={notes} loading={notesLoading} onEditNote={updateNote} onDeleteNote={deleteNote} />
            </div>
          </TabPanel>
        </div>
      </aside>
      <NoteComposer open={noteOpen} onClose={() => setNoteOpen(false)} lead={lead} addNote={addNote} onUpdateLead={save} />
      <EmailComposer lead={lead} open={emailOpen} onClose={() => setEmailOpen(false)} />
      <DeepFindModal open={deepFindOpen} leadIds={[lead.id]} onClose={() => setDeepFindOpen(false)} />
    </div>
  );
}
