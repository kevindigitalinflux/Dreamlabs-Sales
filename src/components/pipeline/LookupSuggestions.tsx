import { useRowSelection } from '../../hooks/useRowSelection';
import { runRowBatch } from '../../lib/rowSelection';
import { BulkActionBar } from '../ui/BulkActionBar';
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
  const [dismissed, setDismissed] = useState<string[]>([]);
  const keyFor = (s: KnownPersonSuggestion) => `${s.field}:${s.value}`;
  const actionable = shown.filter(s => !used[keyFor(s)] && !dismissed.includes(keyFor(s)));
  const selection = useRowSelection(actionable.map(keyFor));
  async function batch() {
    setBusy('batch');
    const chosen = actionable.filter(s => selection.selected.has(keyFor(s)));
    const results = await runRowBatch(chosen, async s => {
      if (chosen.filter(other => other.field === s.field).length > 1) return 'Choose only one value for this field.';
      const error = await onUse(s);
      if (!error) { setUsed(previous => ({...previous, [keyFor(s)]:true})); selection.remove(keyFor(s)); }
      return error;
    });
    setErrors(previous => ({...previous, ...Object.fromEntries(results.map(r => [keyFor(r.row), r.error ?? '']))}));
    setBusy(null);
  }
  if (shown.length === 0) return null;

  async function use(s: KnownPersonSuggestion, key: string) {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: '' }));
    let err: string | null;
    try { err = await onUse(s); }
    catch (error) { err = error instanceof Error ? error.message : 'Could not save this suggestion.'; }
    setBusy(null);
    if (err) setErrors((e) => ({ ...e, [key]: err }));
    else setUsed((u) => ({ ...u, [key]: true }));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-muted">Possible details, not saved yet</p>
      {actionable.length > 0 && <label className="flex items-center gap-2"><input type="checkbox" aria-label="Select all lookup suggestions" disabled={busy !== null} checked={selection.selected.size === actionable.length} onChange={selection.all} />Select all</label>}
      {shown.filter(s => !dismissed.includes(keyFor(s))).map((s) => {
        const key = `${s.field}:${s.value}`;
        return (
          <div key={key} className="flex flex-col gap-1 rounded-md border border-line p-2">
            {!used[key] && <label className="flex items-center gap-2"><input type="checkbox" aria-label={`Select ${s.field}: ${s.value}`} disabled={busy !== null} checked={selection.selected.has(key)} onChange={() => selection.toggle(key)} />Select</label>}
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
      <BulkActionBar count={selection.selected.size} busy={busy !== null} approveLabel="Use selected" rejectLabel="Dismiss selected here" onApprove={() => void batch()} onReject={() => {setDismissed(previous => [...previous, ...selection.selected]); selection.clear();}} onClear={selection.clear} />
    </div>
  );
}
