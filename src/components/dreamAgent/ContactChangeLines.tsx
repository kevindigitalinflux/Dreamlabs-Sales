import { ArrowRight } from 'lucide-react';
import type { ContactDraft } from '../../lib/dreamAgentContacts';
import type { DecisionMakerCandidate } from '../../types';

interface Line { label: string; from: string; to: string }

/** Every field the draft changes compared with the contact as it is NOW (read from the database, never from the AI). */
export function contactChangeLines(existing: DecisionMakerCandidate, d: ContactDraft): Line[] {
  const person = existing.kind === 'person';
  const fields: [string, string | null, string, boolean][] = [
    ['First name', existing.first_name, d.first_name, person],
    ['Last name', existing.last_name, d.last_name, person],
    ['Position', existing.title, d.title, person],
    ['Label', existing.label, d.label, !person],
    ['Email', existing.email, d.email, true],
    ['Phone', existing.phone, d.phone, true],
  ];
  return fields
    .filter(([label, from, to, shown]) => shown && (from ?? '').trim().toLowerCase() !== to.trim().toLowerCase() && !(label === 'Phone' && (from ?? '').trim() === to.trim()))
    .map(([label, from, to]) => ({ label, from: (from ?? '').trim() || '—', to: to.trim() || '—' }));
}

interface ContactChangeLinesProps {
  existing: DecisionMakerCandidate;
  draft: ContactDraft;
}

/** From, to lines plus warning chips for changes that redirect email or the main contact. */
export function ContactChanges({ existing, draft }: ContactChangeLinesProps) {
  const lines = contactChangeLines(existing, draft);
  const emailChanges = lines.some((l) => l.label === 'Email');
  const becomesMain = draft.make_primary && !existing.is_primary;
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {lines.map((l) => (
          <li key={l.label} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface/60 p-2 text-sm">
            <span className="w-24 text-xs font-semibold text-muted">{l.label}</span>
            <span className="text-muted line-through">{l.from}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden />
            <span className="font-semibold text-success">{l.to}</span>
          </li>
        ))}
      </ul>
      {emailChanges && (
        <p role="status" className="w-fit rounded-full border border-warning px-3 py-1 text-xs font-semibold text-warning">
          This changes where emails to {existing.kind === 'person' ? 'this person' : 'this inbox'} go
        </p>
      )}
      {becomesMain && (
        <p role="status" className="w-fit rounded-full border border-warning px-3 py-1 text-xs font-semibold text-warning">
          This makes {existing.kind === 'person' ? 'them' : 'this inbox'} the main contact
        </p>
      )}
    </div>
  );
}
