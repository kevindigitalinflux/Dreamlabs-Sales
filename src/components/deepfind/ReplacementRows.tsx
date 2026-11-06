import { ArrowRight } from 'lucide-react';
import { suggestionKey } from '../../../supabase/functions/_shared/deepFindSuggestions';
import type { ReviewSuggestion } from '../../../supabase/functions/_shared/deepFindSuggestions';
import { groupReplacements } from '../../lib/deepFindReplacements';
import { Button } from '../ui/Button';
import { shortValue } from './Heading';
import {useReviewBatch} from '../../hooks/useReviewBatch';
import {ReviewBatchControls} from '../ui/ReviewBatchControls';

export type ReplacementAction = 'replace' | 'dismiss';
const WRAP = 'break-words [overflow-wrap:anywhere]';

function Candidate({ s, person, old, primary, busy, onAction }: { s: ReviewSuggestion; person: string; old: string; primary: boolean; busy: boolean; onAction: (s: ReviewSuggestion, a: ReplacementAction) => void }) {
  const value = s.value ?? '';
  return <div className="flex min-w-0 flex-col gap-2">
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <ArrowRight size={14} aria-hidden className="shrink-0" />
      <span className={`${WRAP} font-semibold`}>{value}</span>
    </p>
    {s.label && <p className={`${WRAP} text-[13px]`}>{s.label}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant={primary ? 'primary' : 'secondary'} disabled={busy} aria-label={`Replace for ${person}: ${shortValue(old, 80)} with ${shortValue(value, 80)}`} onClick={() => onAction(s, 'replace')}>Replace with {shortValue(value, 60)}</Button>
      <Button variant="ghost" className="!text-offwhite" disabled={busy} aria-label={`Dismiss: ${person}, ${shortValue(value, 80)}`} onClick={() => onAction(s, 'dismiss')}>Dismiss</Button>
    </div>
  </div>;
}

/** Pure rows for saved addresses that do not exist: old address struck through, then the candidate to replace it. */
export function ReplacementRows({ suggestions, busy, onAction }: { suggestions: ReviewSuggestion[]; busy: boolean; onAction: (s: ReviewSuggestion, a: ReplacementAction) => Promise<string|null>|void }) {
  const { groups } = groupReplacements(suggestions);
  const review=useReviewBatch(groups.map(g=>suggestionKey(g.primary)));
  const visible=groups.filter(g=>!review.done.has(suggestionKey(g.primary)));
  const locked=busy||review.busy;
  async function batch(action:ReplacementAction) {
    if(busy||!window.confirm(action==='replace'?'Replace each selected saved address with the primary guess shown? These guesses remain unverified.':'Dismiss the selected primary replacement guesses?'))return;
    await review.run(visible,g=>suggestionKey(g.primary),async g=>(await onAction(g.primary,action))??null,action==='replace'?'Replace':'Dismiss');
  }
  if (groups.length === 0&&!review.summary&&!review.busy) return null;
  return <><ReviewBatchControls review={{...review,busy:locked}} ids={visible.map(g=>suggestionKey(g.primary))} approveLabel="Replace selected" rejectLabel="Dismiss selected" onApprove={()=>void batch('replace')} onReject={()=>void batch('dismiss')} />
  <ul className="grid min-w-0 grid-cols-1 gap-2 text-offwhite">
    {visible.map((g) => <li key={g.contactId} className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface/50 p-3">
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" aria-label={`Select replacement for ${g.name}: ${g.oldEmail} to ${g.primary.value}`} disabled={locked} checked={review.selected.has(suggestionKey(g.primary))} onChange={()=>review.toggle(suggestionKey(g.primary))} />Select primary guess</label>
      <p className={`${WRAP} text-sm font-semibold`}>{g.name}</p>
      <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <s className={WRAP}>{g.oldEmail}</s>
        <span className="rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-xs font-semibold">Does not exist</span>
      </p>
      <Candidate key={suggestionKey(g.primary)} s={g.primary} person={g.name} old={g.oldEmail} primary busy={locked} onAction={onAction} />
      {review.errors[suggestionKey(g.primary)]&&<p role="alert" className="text-sm text-danger">{review.errors[suggestionKey(g.primary)]}</p>}
      {g.others.length > 0 && <details className="min-w-0">
        <summary className="cursor-pointer text-sm focus-visible:outline-2 focus-visible:outline-violet-line">Other possible formats for {g.name} ({g.others.length})</summary>
        <div className="mt-2 flex flex-col gap-3">
          {g.others.map((s) => <Candidate key={suggestionKey(s)} s={s} person={g.name} old={g.oldEmail} primary={false} busy={locked} onAction={onAction} />)}
        </div>
      </details>}
    </li>)}
  </ul></>;
}
