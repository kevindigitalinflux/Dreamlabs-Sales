import { useState } from 'react';
import { needsFollowUpNotice, personName, summariseKnownPerson, visibleSuggestions } from '../../lib/knownPersonForm';
import type {
  DecisionMakerCandidate, KnownPersonInput, KnownPersonResult as KnownPersonResultData, KnownPersonSuggestion,
} from '../../types';
import { Button } from '../ui/Button';
import { LookupSteps } from './LookupSteps';
import { LookupSuggestions } from './LookupSuggestions';

interface KnownPersonResultProps {
  person: KnownPersonInput;
  result: KnownPersonResultData;
  /** The saved contact, once the list has refreshed; used to explain follow-ups. */
  contact?: DecisionMakerCandidate | null;
  /** Extra neutral notes (for example about a phone number). */
  extraNotes?: string[];
  /** The phone the user typed, if any, so its source shows as You. */
  typedPhone?: string;
  /** Saves a second email as another contact; resolves to an error message or null. */
  onAddExtraEmail: (email: string, label: string) => Promise<string | null>;
  /** Saves a suggested value on the person (blank field only); resolves to an error message or null. */
  onUseSuggestion: (s: KnownPersonSuggestion) => Promise<string | null>;
  onClose: () => void;
}

/**
 * What a known-person lookup did: the saved person, each value with who supplied it,
 * each lookup step on its own line, values found but not saved with a "Use this" button,
 * plain-English problems (red) and notes (neutral), and a button to keep a second email
 * a provider found.
 */
export function KnownPersonResult({ person, result, contact, extraNotes = [], typedPhone, onAddExtraEmail, onUseSuggestion, onClose }: KnownPersonResultProps) {
  const summary = summariseKnownPerson(result, person, contact, typedPhone);
  const [busy, setBusy] = useState(false);
  const [extraError, setExtraError] = useState<string | null>(null);
  const [extraDone, setExtraDone] = useState(false);
  const extra = result.extra_email;

  async function addExtra() {
    if (!extra) return;
    setBusy(true); setExtraError(null);
    const err = await onAddExtraEmail(extra, `Alternative email for ${personName(person)}`);
    setBusy(false);
    if (err) setExtraError(err); else setExtraDone(true);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3">
      <p className="text-sm font-semibold text-offwhite">{summary.heading}</p>
      {summary.lines.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-sm text-offwhite">
          {summary.lines.map((l) => (
            <li key={l.label}>{l.label}: {l.value} <span className="text-xs text-muted">({l.source})</span></li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No extra details were found.</p>
      )}
      <LookupSteps steps={summary.steps} />
      {summary.lookups.length > 0 && <p className="text-xs text-muted">{summary.lookups.join('. ')}.</p>}
      {needsFollowUpNotice(contact) && (
        <p className="text-sm text-muted">Found by a search, so it does not receive follow-ups unless you switch it on.</p>
      )}
      {summary.errors.map((m) => <p key={m} role="alert" className="text-sm text-danger">{m}</p>)}
      {[...summary.notes, ...extraNotes].map((m) => <p key={m} className="text-sm text-muted">{m}</p>)}
      <LookupSuggestions
        suggestions={visibleSuggestions(result)}
        filled={{ email: !!contact?.email?.trim(), linkedin_url: !!contact?.linkedin_url?.trim() }}
        onUse={onUseSuggestion}
      />
      {extra && !extraDone && (
        <div className="flex flex-col gap-1">
          <Button variant="secondary" onClick={() => void addExtra()} loading={busy}>Add {extra} as another contact</Button>
          {extraError && <p role="alert" className="text-sm text-danger">{extraError}</p>}
        </div>
      )}
      {extra && extraDone && <p className="text-sm text-success">{extra} added as another contact.</p>}
      <div><Button variant="ghost" onClick={onClose}>Done</Button></div>
    </div>
  );
}
