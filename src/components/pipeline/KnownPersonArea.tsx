import { emptyContactForm } from '../../lib/leadContacts';
import type { ContactFormValues } from '../../lib/leadContacts';
import type { ContactResult } from '../../hooks/useLeadContacts';
import type { useKnownPersonFlow } from '../../hooks/useKnownPersonFlow';
import { planSuggestionUse } from '../../lib/knownPersonForm';
import type { DecisionMakerCandidate, KnownPersonSuggestion } from '../../types';
import { KnownPersonResult } from './KnownPersonResult';

interface KnownPersonAreaProps {
  flow: ReturnType<typeof useKnownPersonFlow>;
  contacts: DecisionMakerCandidate[];
  addContact: (form: ContactFormValues) => Promise<ContactResult>;
  /** The normal contact edit path (useLeadContacts.updateContact). */
  updateContact: (contact: DecisionMakerCandidate, form: ContactFormValues) => Promise<ContactResult>;
  setIncludeInSequences: (id: string, on: boolean) => Promise<ContactResult>;
}

/**
 * Known-person results from the Add person flow; generic searches now use Deep find.
 * The "alternative email" button saves the extra address as a general contact; a
 * duplicate shows the usual "already on this lead" message. "Use this" on a suggestion fills
 * the person's blank field through the normal contact edit, with follow-ups left off for an email.
 */
export function KnownPersonArea({
  flow, contacts, addContact, updateContact, setIncludeInSequences,
}: KnownPersonAreaProps) {
  const outcome = flow.outcome;

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
    </>
  );
}
