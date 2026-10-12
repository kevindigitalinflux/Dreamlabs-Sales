import { useState } from 'react';
import { emptyContactForm } from '../../lib/leadContacts';
import type { ContactFormValues } from '../../lib/leadContacts';
import type { ContactResult } from '../../hooks/useLeadContacts';
import type { useKnownPersonFlow } from '../../hooks/useKnownPersonFlow';
import type { LeadPatch } from '../../lib/leadUpdates';
import { planSuggestionUse } from '../../lib/knownPersonForm';
import type { DecisionMakerCandidate, KnownPersonSuggestion, Lead } from '../../types';
import { DecisionMakerReview } from './DecisionMakerReview';
import { FindDecisionMakerPanel } from './FindDecisionMakerPanel';
import { KnownPersonResult } from './KnownPersonResult';

interface KnownPersonAreaProps {
  leadId: string;
  lead: Lead;
  flow: ReturnType<typeof useKnownPersonFlow>;
  contacts: DecisionMakerCandidate[];
  /** True while the "Find decision maker" panel is open. */
  finding: boolean;
  onCloseFinding: () => void;
  refresh: () => Promise<DecisionMakerCandidate[] | null>;
  addContact: (form: ContactFormValues) => Promise<ContactResult>;
  /** The normal contact edit path (useLeadContacts.updateContact). */
  updateContact: (contact: DecisionMakerCandidate, form: ContactFormValues) => Promise<ContactResult>;
  setIncludeInSequences: (id: string, on: boolean) => Promise<ContactResult>;
  onSave: (patch: LeadPatch) => Promise<string | null>;
}

/**
 * The Find decision maker panel, its generic-search results (the same review modal the
 * bulk search uses, for this one lead) and, after a known-person lookup, its result.
 * The "alternative email" button saves the extra address as a general contact; a
 * duplicate shows the usual "already on this lead" message. "Use this" on a suggestion fills
 * the person's blank field through the normal contact edit, with follow-ups left off for an email.
 */
export function KnownPersonArea({
  leadId, lead, flow, contacts, finding, onCloseFinding, refresh, addContact, updateContact, setIncludeInSequences, onSave,
}: KnownPersonAreaProps) {
  const outcome = flow.outcome;
  const [review, setReview] = useState<Record<string, DecisionMakerCandidate[]> | null>(null);

  async function applySuggestion(contactId: string, suggestion: KnownPersonSuggestion): Promise<string | null> {
    const plan = planSuggestionUse(contacts.find((c) => c.id === contactId), suggestion);
    if (!plan.ok) return plan.error;
    const saved = await updateContact(plan.contact, plan.form);
    if (saved.error) return saved.error;
    if (plan.switchOffAfter) {
      const off = await setIncludeInSequences(plan.contact.id, false);
      if (off.error) return `Saved, but follow-ups could not be switched off: ${off.error}. Switch them off on the contact.`;
    }
    return null;
  }

  async function handleSearched(found: Record<string, DecisionMakerCandidate[]>): Promise<string | null> {
    const rows = await refresh();
    setReview({ [leadId]: found[leadId] ?? [] });
    return rows ? null : 'The contact list could not be refreshed. Reload the page to see new people.';
  }

  return (
    <>
      {outcome && (
        <KnownPersonResult
          person={outcome.person}
          result={outcome.result}
          contact={contacts.find((c) => c.id === outcome.result.contact_id)}
          extraNotes={outcome.notes}
          typedPhone={outcome.typedPhone}
          onAddExtraEmail={async (email, label) => (await addContact({ ...emptyContactForm('general'), label, email })).error}
          onUseSuggestion={(sg) => applySuggestion(outcome.result.contact_id, sg)}
          onClose={flow.clear}
        />
      )}
      {finding && (
        <FindDecisionMakerPanel
          key={leadId}
          leadId={leadId}
          lookingUp={flow.lookingUp}
          onLookup={flow.lookup}
          onSearched={handleSearched}
          onClose={onCloseFinding}
        />
      )}
      <DecisionMakerReview
        open={review !== null}
        resultsByLead={review ?? {}}
        leadsById={{ [leadId]: lead }}
        onClose={() => setReview(null)}
        onAddToLead={(_id, patch) => onSave(patch)}
      />
    </>
  );
}
