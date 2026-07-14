import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, X } from 'lucide-react';
import type { LeadPatch } from '../../lib/leadUpdates';
import { STAGES } from '../../lib/utils';
import { useLeadNotes } from '../../hooks/useLeadNotes';
import { useAuth } from '../../hooks/useAuth';
import type { Lead, Profile, Stage } from '../../types';
import { Button } from '../ui/Button';
import { SelectField } from '../ui/Input';
import { StageBadge } from './StageBadge';
import { NextActionEditor } from './NextActionEditor';
import { ContactInfo, NotesPreview, PipelineInfo } from './LeadPanelSections';
import { NoteComposer } from './NoteComposer';

interface LeadPanelProps {
  lead: Lead | null;
  profiles: Profile[];
  onClose: () => void;
  onUpdate: (id: string, patch: LeadPatch) => Promise<string | null>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line pb-4">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

/** Right slide-in expanded card (SPEC.md §6). Renders nothing when no lead selected. */
export function LeadPanel({ lead, profiles, onClose, onUpdate }: LeadPanelProps) {
  const navigate = useNavigate();
  const { profile: me } = useAuth();
  const [noteOpen, setNoteOpen] = useState(false);
  const { notes, loading: notesLoading, addNote } = useLeadNotes(lead?.id ?? 'none');

  if (!lead) return null;
  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={lead.business_name}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-line bg-card p-5 motion-safe:animate-[slidein_.15s_ease-out]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-bold">{lead.business_name}</h2>
            {lead.owner_name && <p className="text-sm text-muted">{lead.owner_name}</p>}
            <div className="mt-2"><StageBadge stage={lead.stage} /></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close panel" className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <Section title="Stage">
          <SelectField label="Move to stage" value={lead.stage} onChange={(e) => void onUpdate(lead.id, { stage: e.target.value as Stage })}>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </SelectField>
        </Section>

        <Section title="Contact"><ContactInfo lead={lead} onSave={(patch) => onUpdate(lead.id, patch)} /></Section>
        <Section title="Pipeline"><PipelineInfo lead={lead} onSave={(patch) => onUpdate(lead.id, patch)} /></Section>

        <Section title="Next action">
          <NextActionEditor lead={lead} onSave={(patch) => onUpdate(lead.id, patch)} />
        </Section>

        {me?.role === 'admin' && (
          <Section title="Assignment">
            <SelectField label="Assigned to" value={lead.assigned_to ?? ''} onChange={(e) => void onUpdate(lead.id, { assigned_to: e.target.value || null })}>
              <option value="">Unassigned</option>
              {profiles.filter((p) => p.role === 'contractor').map((p) => (
                <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
              ))}
            </SelectField>
          </Section>
        )}

        <Section title="Recent notes"><NotesPreview notes={notes} loading={notesLoading} /></Section>

        <div className="mt-auto flex flex-col gap-2">
          <Button onClick={() => setNoteOpen(true)}>Log note</Button>
          <Button onClick={() => navigate(`/pipeline/leads/${lead.id}`)}>
            Open full record <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" disabled title="Email automation arrives in cycle 2">Draft email</Button>
            <Button variant="secondary" className="flex-1" disabled title="Sequences arrive in cycle 2">Enroll in sequence</Button>
          </div>
        </div>
      </aside>
      {lead && (
        <NoteComposer
          open={noteOpen}
          onClose={() => setNoteOpen(false)}
          lead={lead}
          addNote={addNote}
          onUpdateLead={(patch) => onUpdate(lead.id, patch)}
        />
      )}
    </div>
  );
}
