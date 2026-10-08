import { useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { readableInvokeError } from '../../lib/invokeError';
import type { LeadPatch } from '../../lib/leadUpdates';
import { additionsPatchFor } from '../../lib/decisionMakerAdditions';
import { emptyContactForm } from '../../lib/leadContacts';
import { mainContact, sequenceRecipients } from '../../../supabase/functions/_shared/contacts';
import { useLeadContacts } from '../../hooks/useLeadContacts';
import type { ContactResult } from '../../hooks/useLeadContacts';
import type { DecisionMakerCandidate, Lead } from '../../types';
import { Button } from '../ui/Button';
import { ContactForm } from './ContactForm';
import { ContactRow } from './ContactRow';

type Adding = 'person' | 'general' | null;

/**
 * The lead's Contacts: named people and general inboxes together, kept live by
 * realtime. Pick the main contact, switch follow-ups on or off per contact, edit
 * details in place, add your own people or inboxes, and keep the existing
 * provider actions (Apollo reveal, "Add to lead", LinkedIn). The lead's own
 * record is the permanent home; the bulk-search review modal is only transient.
 */
export function DecisionMakersCard({ leadId, lead, onSave }: { leadId: string; lead: Lead; onSave: (patch: LeadPatch) => Promise<string | null> }) {
  const hook = useLeadContacts(leadId);
  const { contacts } = hook;
  const [adding, setAdding] = useState<Adding>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  function report(id: string, error: string | null) {
    setErrors((prev) => {
      const next = { ...prev };
      if (error) next[id] = error; else delete next[id];
      return next;
    });
  }

  async function run(id: string, job: () => Promise<ContactResult>): Promise<ContactResult> {
    setBusyId(id);
    const result = await job();
    setBusyId(null);
    report(id, result.error);
    setNotice(result.notice ?? null);
    return result;
  }

  async function handleAddToLead(c: DecisionMakerCandidate) {
    setBusyId(c.id);
    const patch = additionsPatchFor(lead, [c]);
    const err = patch ? await onSave(patch) : null;
    setBusyId(null);
    report(c.id, err);
  }

  async function handleReveal(c: DecisionMakerCandidate, field: 'reveal_email' | 'reveal_phone') {
    setBusyId(c.id);
    const { data, error } = await supabase.functions.invoke('reveal-decision-maker', { body: { candidate_id: c.id, [field]: true } });
    setBusyId(null);
    const apiError = error ? await readableInvokeError(error) : (data as { error?: string } | null)?.error;
    report(c.id, apiError ?? null); // the realtime subscription applies the actual update
  }

  if (hook.loading) return <p className="text-sm text-muted">Loading…</p>;
  if (hook.loadError) return <p role="alert" className="text-sm text-danger">{hook.loadError}</p>;

  const main = mainContact(contacts, lead.email ?? null);
  const noFollowUps = contacts.length > 0 && !lead.opted_out && sequenceRecipients(contacts, lead.email ?? null, false).length === 0;

  return (
    <div className="flex flex-col gap-2">
      {contacts.length === 0 && (
        <p className="text-sm text-muted">No contacts yet. Add one below, or use "Find decision maker" from the Pipeline list to search.</p>
      )}
      {noFollowUps && <p role="status" className="text-sm text-danger">No contact is set to receive follow-ups. Turn on "Include in sequences" for one with an email.</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}
      <ul className="flex flex-col gap-2">
        {contacts.map((c) => (
          <ContactRow
            key={c.id}
            contact={c}
            lead={lead}
            isMain={main?.contactId === c.id}
            busy={busyId === c.id}
            error={errors[c.id]}
            onMakeMain={() => void run(c.id, () => hook.setPrimary(c.id))}
            onToggleSequences={(on) => void run(c.id, () => hook.setIncludeInSequences(c.id, on))}
            onSave={(form) => run(c.id, () => hook.updateContact(c, form))}
            onRemove={async () => (await run(c.id, () => hook.removeContact(c))).error}
            onReveal={(field) => void handleReveal(c, field)}
            onAddToLead={() => void handleAddToLead(c)}
          />
        ))}
      </ul>
      {adding ? (
        <ContactForm
          initial={emptyContactForm(adding)}
          submitLabel={adding === 'person' ? 'Add person' : 'Add general email'}
          onSubmit={(form) => run('new', () => hook.addContact(form))}
          onCancel={() => setAdding(null)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAdding('person')}><Plus className="h-4 w-4" aria-hidden /> Add person</Button>
          <Button variant="secondary" onClick={() => setAdding('general')}><Plus className="h-4 w-4" aria-hidden /> Add general email</Button>
        </div>
      )}
    </div>
  );
}
