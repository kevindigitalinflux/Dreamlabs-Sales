import { emptyContactForm } from '../../lib/leadContacts';
import type { ContactResult } from '../../hooks/useLeadContacts';
import type { useKnownPersonFlow } from '../../hooks/useKnownPersonFlow';
import type { ContactFormValues } from '../../lib/leadContacts';
import type { DecisionMakerCandidate } from '../../types';
import { FindDecisionMakerPanel } from './FindDecisionMakerPanel';
import { KnownPersonResult } from './KnownPersonResult';

interface KnownPersonAreaProps {
  leadId: string;
  flow: ReturnType<typeof useKnownPersonFlow>;
  contacts: DecisionMakerCandidate[];
  /** True while the "Find decision maker" panel is open. */
  finding: boolean;
  onCloseFinding: () => void;
  refresh: () => Promise<void>;
  addContact: (form: ContactFormValues) => Promise<ContactResult>;
}

/**
 * The Find decision maker panel and, after a known-person lookup, its result. The
 * "alternative email" button saves the extra address as a general contact; a duplicate
 * shows the usual "already on this lead" message.
 */
export function KnownPersonArea({ leadId, flow, contacts, finding, onCloseFinding, refresh, addContact }: KnownPersonAreaProps) {
  const outcome = flow.outcome;
  return (
    <>
      {outcome && (
        <KnownPersonResult
          person={outcome.person}
          result={outcome.result}
          contact={contacts.find((c) => c.id === outcome.result.contact_id)}
          onAddExtraEmail={async (email, label) => (await addContact({ ...emptyContactForm('general'), label, email })).error}
          onClose={flow.clear}
        />
      )}
      {finding && (
        <FindDecisionMakerPanel
          key={leadId}
          leadId={leadId}
          lookingUp={flow.lookingUp}
          lookupError={flow.error}
          onLookup={flow.lookup}
          onSearched={refresh}
          onClose={onCloseFinding}
        />
      )}
    </>
  );
}
