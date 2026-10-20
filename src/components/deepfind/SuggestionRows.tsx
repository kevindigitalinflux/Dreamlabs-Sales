import { isRoleMailbox, suggestionKey } from '../../../supabase/functions/_shared/deepFindSuggestions';
import type { ReviewSuggestion } from '../../../supabase/functions/_shared/deepFindSuggestions';
import { Button } from '../ui/Button';
import { websiteHref } from '../../lib/websiteHref';

const FIELD_LABELS: Record<string, string> = { phone: 'phone', website: 'website', owner_name: 'owner name', title: 'title' };

/** Pure rows: no saving or session access. Parent owns optimistic review state. */
export function SuggestionRows({ suggestions, busy, onAction }: {
  suggestions: ReviewSuggestion[]; busy: boolean;
  onAction: (suggestion: ReviewSuggestion, action: 'add' | 'dismiss') => void;
}) {
  return <ul className="grid min-w-0 grid-cols-1 gap-2 text-offwhite">
    {suggestions.map((s) => <li key={suggestionKey(s)} className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface/50 p-3">
      <p className="break-all text-sm font-semibold">{s.name}{s.role ? ` (${s.role})` : ''}{s.field && FIELD_LABELS[s.field] ? ` (${FIELD_LABELS[s.field]})` : ''}{s.value && <>: {(s.field === 'linkedin_url' || s.field === 'website') && websiteHref(s.value)?.startsWith('https://')
        ? <a href={websiteHref(s.value)!} rel="noreferrer noopener" target="_blank" className="font-normal text-offwhite underline focus-visible:outline-2 focus-visible:outline-violet">{s.value}</a>
        : <span className="font-normal">{s.value}</span>}</>}</p>
      {(s.label || ((!s.field || s.field === 'email') && isRoleMailbox(s.value))) && <div className="flex flex-wrap gap-1.5">
        {s.label && <span className="break-words rounded-full border border-line bg-surface px-2 py-0.5 text-xs">{s.label}</span>}
        {(!s.field || s.field === 'email') && isRoleMailbox(s.value) && <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs">Role mailbox, not useful for outreach</span>}
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} aria-label={`Add to lead: ${s.value ?? s.name}`} onClick={() => onAction(s, 'add')}>Add to lead</Button>
        <Button variant="ghost" className="!text-offwhite" disabled={busy} aria-label={`Dismiss: ${s.value ?? s.name}`} onClick={() => onAction(s, 'dismiss')}>Dismiss</Button>
      </div>
    </li>)}
  </ul>;
}
