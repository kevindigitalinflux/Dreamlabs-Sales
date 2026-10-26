import { useState } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';
import { ConfirmDeleteButton } from '../ui/ConfirmDeleteButton';
import { ContactForm } from './ContactForm';
import { ContactRevealButtons } from './ContactRevealButtons';
import { PhoneChip } from './PhoneChip';
import { PhoneBusinessNotice } from './PhoneBusinessNotice';
import { parsePhone } from '../../../supabase/functions/_shared/phoneNumbers';
import type { LeadPatch } from '../../lib/leadUpdates';
import { contactDisplayName } from '../../../supabase/functions/_shared/contacts';
import { candidateSourceLabel, hasNoContactDetails, isProviderSource, isRegistrySource } from '../../lib/candidateSource';
import { contactToForm, isOwnSource, safeLinkedinHref } from '../../lib/leadContacts';
import type { ContactFormValues } from '../../lib/leadContacts';
import type { ContactResult } from '../../hooks/useLeadContacts';
import type { DecisionMakerCandidate, Lead } from '../../types';

interface ContactRowProps {
  contact: DecisionMakerCandidate;
  lead: Lead;
  /** True when this is the contact emailed by default (marked, or the best-ranked one). */
  isMain: boolean;
  busy: boolean;
  apolloConfigured?: boolean;
  error?: string;
  onMakeMain: () => void;
  onToggleSequences: (on: boolean) => void;
  onSave: (form: ContactFormValues) => Promise<ContactResult>;
  onRemove: () => Promise<string | null>;
  onReveal: (field: 'reveal_email' | 'reveal_phone') => void;
  onAddToLead: () => void;
  onSaveLead: (patch: LeadPatch) => Promise<string | null>;
}

/**
 * One contact (person or general inbox): details, source badge, "Use this one"
 * radio, "Include in sequences" switch, inline edit, provider actions, and a
 * confirmed remove (deletes your own contacts, dismisses ones a search found).
 */
export function ContactRow({ contact, lead, isMain, busy, apolloConfigured, error, onMakeMain, onToggleSequences, onSave, onRemove, onReveal, onAddToLead, onSaveLead }: ContactRowProps) {
  const [editing, setEditing] = useState(false);
  const name = contactDisplayName(contact);
  if (editing) {
    return <li><ContactForm initial={contactToForm(contact)} storedLinkedin={contact.linkedin_url} submitLabel="Save changes" onSubmit={onSave} onCancel={() => setEditing(false)} /></li>;
  }
  const own = isOwnSource(contact.source);
  return (
    <li className="rounded-lg bg-surface/60 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted">{candidateSourceLabel(contact.source)}</span>
        {contact.kind === 'general' && <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted">General inbox</span>}
        {isMain && <span className="rounded-full bg-violet/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet">Main</span>}
        <span className="font-semibold">{name}</span>
        {contact.title && <span className="text-muted">({contact.title})</span>}
        <button type="button" aria-label={`Edit ${name}`} onClick={() => setEditing(true)} className="ml-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded text-muted hover:text-offwhite">
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {contact.email && <a href={`mailto:${contact.email}`} className="text-success">{contact.email}</a>}
        {contact.phone && <PhoneChip value={contact.phone} country={lead.country} metadata={{ ...lead.phone_meta?.[parsePhone(contact.phone, lead.country)?.value ?? ''], kind: contact.phone_kind ?? 'unknown', source: contact.phone_source ?? 'manual', source_url: contact.phone_source_url ?? null, found_at: contact.phone_found_at ?? null }} />}
        {contact.linkedin_url && (safeLinkedinHref(contact.linkedin_url) ? (
          <a href={safeLinkedinHref(contact.linkedin_url)!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-cyan">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> LinkedIn
          </a>
        ) : <span className="text-muted">{contact.linkedin_url}</span>)}
      </div>
      {isRegistrySource(contact.source) && hasNoContactDetails(contact) && (
        <p className="mt-1 text-xs text-muted">No contact details found yet. Use "Deep find" to look them up.</p>
      )}
      <ContactRevealButtons contact={contact} lead={lead} busy={busy} apolloConfigured={apolloConfigured} onReveal={onReveal} onAddToLead={onAddToLead} />
      {contact.phone && <PhoneBusinessNotice value={contact.phone} lead={lead} onSave={onSaveLead} />}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        <label className="flex min-h-8 cursor-pointer items-center gap-1.5 text-xs">
          <input type="radio" name={`main-contact-${contact.lead_id}`} checked={contact.is_primary} disabled={!contact.email} onChange={onMakeMain} />
          Use this one
        </label>
        <label className="flex min-h-8 cursor-pointer items-center gap-1.5 text-xs">
          <input type="checkbox" role="switch" checked={contact.include_in_sequences} disabled={!contact.email} onChange={(e) => onToggleSequences(e.target.checked)} />
          Include in sequences
        </label>
        <ConfirmDeleteButton label={own ? 'Remove' : 'Dismiss'} question={own ? 'Remove this contact?' : 'Dismiss this contact?'} onConfirm={onRemove} />
      </div>
      {isProviderSource(contact.source) && !contact.include_in_sequences && (
        <p className="mt-0.5 text-xs text-muted">Found by a search, so it does not receive follow-ups unless you switch this on</p>
      )}
      {contact.kind === 'general' && !contact.include_in_sequences && (
        <p className="mt-0.5 text-xs text-muted">Turning this off for a general inbox changes which email is treated as main when nothing is marked.</p>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </li>
  );
}
