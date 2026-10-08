import { useState } from 'react';
import { UserPlus, UserCog } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ContactChanges } from './ContactChangeLines';
import { draftFromAction, draftProblem } from '../../lib/dreamAgentContacts';
import type { ContactAction, ContactDraft } from '../../lib/dreamAgentContacts';
import type { ActionResolution } from '../../hooks/useDreamAgentSession';
import type { DecisionMakerCandidate } from '../../types';

interface ContactActionRowProps {
  action: ContactAction;
  resolution: ActionResolution;
  leadName: string;
  /** For update_contact: the contact as it is now (undefined while it is still loading). */
  existing?: DecisionMakerCandidate;
  /** The lead's live contacts (used to catch an email another contact already has). */
  leadContacts: DecisionMakerCandidate[];
  /** False while this lead's contacts are still being read. */
  contactsLoaded: boolean;
  /** What the user wrote in the conversation, to tell a real quote from an AI summary. */
  messages: string[];
  onResolve: (resolution: ActionResolution) => void;
}

type TextKey = 'first_name' | 'last_name' | 'title' | 'label' | 'email' | 'phone';

/**
 * One proposed contact change from Dream Agent: an add or an edit of a person or
 * general inbox on a lead. Every value can be corrected before confirming. A row
 * that cannot be saved as it stands shows why and its Confirm button is off. Nothing
 * is written until the user confirms and applies.
 */
export function ContactActionRow({ action, resolution, leadName, existing, leadContacts, contactsLoaded, messages, onResolve }: ContactActionRowProps) {
  const [draft, setDraft] = useState<ContactDraft>(() => (resolution.status === 'confirmed_contact' ? resolution.draft : draftFromAction(action, existing)));
  const [dirty, setDirty] = useState(false);
  const confirmed = resolution.status === 'confirmed_contact';
  const isAdd = action.type === 'add_contact';
  const kind = action.type === 'add_contact' ? action.kind : existing?.kind ?? 'person';
  const isPerson = kind === 'person';
  const Icon = isAdd ? UserPlus : UserCog;
  const waiting = !isAdd && !existing;
  const alreadyMain = !isAdd && existing?.is_primary === true;
  const others = leadContacts.filter((c) => c.id !== existing?.id);
  const waitingReason = contactsLoaded ? 'This contact no longer exists.' : 'Loading the current contact details…';
  const problem = waiting ? waitingReason : draftProblem(kind, draft, others) ?? (dirty ? null : action.invalid ?? null);
  const lower = (action.excerpt ?? '').toLowerCase();
  const quoted = lower !== '' && messages.some((m) => m.toLowerCase().includes(lower));

  function edit(key: keyof ContactDraft, value: string | boolean) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
    if (confirmed) onResolve({ status: 'pending' });
  }
  const text = (key: TextKey) => (e: { target: { value: string } }) => edit(key, e.target.value);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-cyan" aria-hidden />
        {isAdd ? 'Add' : 'Update'} {isPerson ? 'person' : 'general inbox'} on {leadName}
      </p>
      {action.excerpt && <p className="text-xs text-muted">{quoted ? <>&ldquo;{action.excerpt}&rdquo;</> : <>AI summary: {action.excerpt}</>}</p>}
      {!isAdd && existing && <ContactChanges existing={existing} draft={draft} />}
      {isPerson ? (
        <div className="grid grid-cols-2 gap-2">
          <Input label="First name" value={draft.first_name} onChange={text('first_name')} autoComplete="off" disabled={waiting} />
          <Input label="Last name" value={draft.last_name} onChange={text('last_name')} autoComplete="off" disabled={waiting} />
        </div>
      ) : (
        <Input label="Label (for example Accounts)" value={draft.label} onChange={text('label')} autoComplete="off" disabled={waiting} />
      )}
      {isPerson && <Input label="Position" value={draft.title} onChange={text('title')} autoComplete="off" disabled={waiting} />}
      <Input label="Email" type="email" value={draft.email} onChange={text('email')} autoComplete="off" disabled={waiting} />
      <Input label="Phone" type="tel" value={draft.phone} onChange={text('phone')} autoComplete="off" disabled={waiting} />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.make_primary || alreadyMain} disabled={waiting || alreadyMain} onChange={(e) => edit('make_primary', e.target.checked)} className="h-4 w-4 accent-violet-500" />
        {alreadyMain ? 'Already the main contact' : 'Make this the main contact'}
      </label>
      {action.rationale && <p className="text-xs text-muted">{action.rationale}</p>}
      {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => onResolve({ status: 'dismissed' })}>Dismiss</Button>
        <Button
          variant={confirmed ? 'secondary' : 'primary'}
          disabled={problem !== null}
          onClick={() => onResolve({ status: 'confirmed_contact', draft })}
        >
          {confirmed ? 'Confirmed ✓' : 'Confirm'}
        </Button>
      </div>
    </div>
  );
}
