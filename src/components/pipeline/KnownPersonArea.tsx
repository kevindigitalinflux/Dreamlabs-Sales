import { useState } from 'react';
import { emptyContactForm } from '../../lib/leadContacts';
import type { ContactFormValues } from '../../lib/leadContacts';
import type { ContactResult } from '../../hooks/useLeadContacts';
import type { useKnownPersonFlow } from '../../hooks/useKnownPersonFlow';
import type { LeadPatch } from '../../lib/leadUpdates';
import type { DecisionMakerCandidate, Lead } from '../../types';
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
  onSave: (patch: LeadPatch) => Promise<string | null>;
}

/**
 * The Find decision maker panel, its generic-search results (the same review modal the
 * bulk search uses, for this one lead) and, after a known-person lookup, its result.
 * The "alternative email" button saves the extra address as a general contact; a
 * duplicate shows the usual "already on this lead" message.
 */
export function KnownPersonArea({ leadId, lead, flow, contacts, finding, onCloseFinding, refresh, addContact, onSave }: KnownPersonAreaProps) {
  const outcome = flow.outcome;
  const [review, setReview] = useState<Record<string, DecisionMakerCandidate[]> | null>(null);

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
