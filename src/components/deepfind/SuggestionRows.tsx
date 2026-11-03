import { useState } from 'react';
import { useRowSelection } from '../../hooks/useRowSelection';
import { runRowBatch } from '../../lib/rowSelection';
import { BulkActionBar } from '../ui/BulkActionBar';
import { isRoleMailbox, suggestionKey } from '../../../supabase/functions/_shared/deepFindSuggestions';
import type { ReviewSuggestion } from '../../../supabase/functions/_shared/deepFindSuggestions';
import { Button } from '../ui/Button';
import { websiteHref } from '../../lib/websiteHref';
import { shortValue } from './Heading';
import { PhoneChip } from '../pipeline/PhoneChip';

const FIELD_LABELS: Record<string, string> = { phone: 'phone', person_phone: 'phone for this person', website: 'website', owner_name: 'owner name', title: 'title' };

/** Pure rows: no saving or session access. Parent owns optimistic review state. */
export function SuggestionRows({ suggestions, busy, onAction }: {
  suggestions: ReviewSuggestion[]; busy: boolean;
  onAction: (suggestion: ReviewSuggestion, action: 'add' | 'dismiss') => Promise<string | null>;
}) {
  const primary = suggestions.filter(s => s.guess_rank !== 'other');
  const others = suggestions.filter(s => s.guess_rank === 'other');
  const groups = [...new Set(others.map(s => s.name))];
  const actionable = primary.filter(s => !((!s.field || s.field === 'email') && isRoleMailbox(s.value)));
  const selection = useRowSelection(actionable.map(suggestionKey));
  const [batchBusy, setBatchBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  async function batch(action: 'add' | 'dismiss') {
    setBatchBusy(true); setFailures([]);
    const results = await runRowBatch(actionable.filter(s => selection.selected.has(suggestionKey(s))), s => onAction(s, action));
    for (const result of results) if (!result.error) selection.remove(suggestionKey(result.row));
    setFailures(results.flatMap(r => r.error ? [`${r.row.name}: ${r.error}`] : []));
    setBatchBusy(false);
  }
  const locked = busy || batchBusy;
  return <>
  {actionable.length > 0 && <label className="flex items-center gap-2"><input type="checkbox" aria-label="Select all suggestions" disabled={locked} checked={selection.selected.size === actionable.length} onChange={selection.all} />Select all</label>}

  <ul className="grid min-w-0 grid-cols-1 gap-2 text-offwhite">
    {primary.map((s) => <li key={suggestionKey(s)} className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface/50 p-3">
      <label className="flex items-center gap-2"><input type="checkbox" aria-label={`Select suggestion for ${s.name}: ${s.value}`} disabled={locked || !actionable.includes(s)} checked={selection.selected.has(suggestionKey(s))} onChange={() => selection.toggle(suggestionKey(s))} />Select{!actionable.includes(s) && ' (role mailbox cannot be added)'}</label>
      <p className="min-w-0 break-words text-sm font-semibold">{s.name}{s.role ? ` (${s.role})` : ''}{s.field && FIELD_LABELS[s.field] ? ` (${FIELD_LABELS[s.field]})` : ''}{s.value && <>: {(s.field === 'linkedin_url' || s.field === 'website') && websiteHref(s.value)?.startsWith('https://')
        ? <a href={websiteHref(s.value)!} rel="noreferrer noopener" target="_blank" className="break-words font-normal text-offwhite underline [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-violet-line">{s.value}</a>
        : <span className="break-words font-normal [overflow-wrap:anywhere]">{s.value}</span>}</>}</p>
      {s.phone && s.value && <PhoneChip value={s.value} metadata={s.phone} />}
      {(s.label || ((!s.field || s.field === 'email') && isRoleMailbox(s.value))) && <div className="flex flex-wrap gap-1.5">
        {s.label && <span className="break-words rounded-full border border-line bg-surface px-2 py-0.5 text-xs">{s.label}</span>}
        {(!s.field || s.field === 'email') && isRoleMailbox(s.value) && <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs">Role mailbox, not useful for outreach</span>}
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={locked} aria-label={`Add to ${s.field === 'person_phone' ? 'person' : 'lead'}: ${s.name}${s.value ? `, ${shortValue(s.value, 80)}` : ''}`} onClick={() => void onAction(s, 'add')}>{s.field === 'person_phone' ? 'Add' : 'Add to lead'}</Button>
        <Button variant="ghost" className="!text-offwhite" disabled={locked} aria-label={`Dismiss: ${s.name}${s.value ? `, ${shortValue(s.value, 80)}` : ''}`} onClick={() => void onAction(s, 'dismiss')}>Dismiss</Button>
      </div>
    </li>)}
  </ul>
  <BulkActionBar count={selection.selected.size} busy={locked} approveLabel="Add selected" rejectLabel="Dismiss selected" onApprove={() => void batch('add')} onReject={() => void batch('dismiss')} onClear={selection.clear} />
  {failures.map((failure, i) => <p key={i} role="alert" className="text-danger-strong">{failure}</p>)}
  {groups.map(name => <details key={name} className="mt-2 min-w-0">
    <summary className="cursor-pointer break-words text-sm text-offwhite [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-violet-line">Other possible formats for {name}</summary>
    <SuggestionRows suggestions={others.filter(s => s.name === name).map(s => ({ ...s, guess_rank: undefined }))} busy={locked} onAction={onAction} />
  </details>)}
  </>;
}
