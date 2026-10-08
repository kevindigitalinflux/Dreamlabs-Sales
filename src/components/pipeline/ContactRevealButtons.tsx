import { Button } from '../ui/Button';
import { additionsFor, alreadyOnLead } from '../../lib/decisionMakerAdditions';
import type { DecisionMakerCandidate, Lead } from '../../types';

interface ContactRevealButtonsProps {
  contact: DecisionMakerCandidate;
  lead: Lead;
  busy: boolean;
  onReveal: (field: 'reveal_email' | 'reveal_phone') => void;
  onAddToLead: () => void;
}

/**
 * Provider-specific actions on a contact: Apollo's paid email / phone reveal and
 * the "Add to lead" shortcut that copies the person's details into the lead's
 * additional fields.
 */
export function ContactRevealButtons({ contact, lead, busy, onReveal, onAddToLead }: ContactRevealButtonsProps) {
  const additions = additionsFor(contact);
  const added = additions.length > 0 && alreadyOnLead(lead, additions);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {contact.source === 'apollo' && (
        <>
          <Button variant="secondary" onClick={() => onReveal('reveal_email')} disabled={busy || contact.email_revealed} loading={busy}>
            {contact.email_revealed ? 'Email revealed ✓' : busy ? 'Revealing…' : 'Reveal email'}
          </Button>
          <Button variant="secondary" onClick={() => onReveal('reveal_phone')} disabled={busy || contact.phone_status !== 'not_requested'} loading={busy}>
            {contact.phone_status === 'revealed' ? 'Phone revealed ✓'
              : contact.phone_status === 'pending' ? 'Waiting for phone number…'
              : contact.phone_status === 'not_found' ? 'No phone found'
              : busy ? 'Revealing…' : 'Reveal phone'}
          </Button>
        </>
      )}
      {additions.length > 0 && (
        <Button variant="secondary" onClick={onAddToLead} disabled={added || busy} loading={busy}>
          {added ? 'Added to lead ✓' : 'Add to lead'}
        </Button>
      )}
    </div>
  );
}
