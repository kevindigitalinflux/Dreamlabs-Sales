import { useState } from 'react';
import type { KnownPersonSuggestion } from '../../types';
import { Button } from '../ui/Button';

interface LookupSuggestionsProps {
  suggestions: KnownPersonSuggestion[];
  /** Fields the saved person already has; an unused suggestion for one of them is hidden. */
  filled: Record<KnownPersonSuggestion['field'], boolean>;
  /** Saves one suggestion on the person; resolves to an error message or null. */
  onUse: (s: KnownPersonSuggestion) => Promise<string | null>;
}

const FIELD_LABEL: Record<KnownPersonSuggestion['field'], string> = { email: 'Email', linkedin_url: 'LinkedIn' };

/**
 * Values the lookup found but did not save (a web-search find or an unverified guess), each with its label and a
 * "Use this" button. Nothing is saved until the user clicks; a used email does not receive follow-ups until the
 * user switches them on.
 */
export function LookupSuggestions({ suggestions, filled, onUse }: LookupSuggestionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [used, setUsed] = useState<Record<string, boolean>>({});
  const shown = suggestions.filter((s) => used[`${s.field}:${s.value}`] || !filled[s.field]);
  if (shown.length === 0) return null;

  async function use(s: KnownPersonSuggestion, key: string) {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: '' }));
    const err = await onUse(s);
    setBusy(null);
    if (err) setErrors((e) => ({ ...e, [key]: err }));
    else setUsed((u) => ({ ...u, [key]: true }));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-muted">Possible details, not saved yet</p>
      {shown.map((s) => {
        const key = `${s.field}:${s.value}`;
        return (
          <div key={key} className="flex flex-col gap-1 rounded-md border border-line p-2">
            <p className="break-all text-sm text-offwhite">
              {FIELD_LABEL[s.field]}: {s.value} <span className="text-xs text-warning">({s.label})</span>
            </p>
            {used[key] ? (
              <p className="text-sm text-success">Saved on this person.{s.field === 'email' ? ' Follow-ups stay off until you switch them on.' : ''}</p>
            ) : (
              <div>
                <Button variant="secondary" onClick={() => void use(s, key)} loading={busy === key} disabled={busy !== null && busy !== key}>
                  Use this
                </Button>
              </div>
            )}
            {errors[key] && <p role="alert" className="text-sm text-danger">{errors[key]}</p>}
          </div>
        );
      })}
    </div>
  );
}
