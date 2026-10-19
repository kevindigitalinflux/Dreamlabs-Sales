import { isRoleMailbox, suggestionKey } from '../../../supabase/functions/_shared/deepFindSuggestions';
import type { ReviewSuggestion } from '../../../supabase/functions/_shared/deepFindSuggestions';
import { Button } from '../ui/Button';
import { websiteHref } from '../../lib/websiteHref';

/** Pure rows: no saving or session access. Parent owns optimistic review state. */
export function SuggestionRows({ suggestions, busy, onAction }: {
  suggestions: ReviewSuggestion[]; busy: boolean;
  onAction: (suggestion: ReviewSuggestion, action: 'add' | 'dismiss') => void;
}) {
  return <ul className="flex min-w-0 flex-col gap-2">
    {suggestions.map((s) => <li key={suggestionKey(s)} className="flex min-w-0 flex-col gap-1 rounded-md border border-line p-2">
      <p className="break-all text-sm">{s.name}{s.role ? ` (${s.role})` : ''}{s.value && <>: {s.field === 'linkedin_url' && websiteHref(s.value)?.startsWith('https://')
        ? <a href={websiteHref(s.value)!} rel="noreferrer noopener" target="_blank" className="text-cyan underline focus:outline focus:outline-cyan">{s.value}</a>
        : s.value}</>}</p>
      {s.label && <p className="break-words text-xs text-muted">{s.label}</p>}
      {isRoleMailbox(s.value) && <p className="text-xs text-muted">Role mailbox, not useful for outreach</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} aria-label={`Add to lead: ${s.value ?? s.name}`} onClick={() => onAction(s, 'add')}>Add to lead</Button>
        <Button variant="ghost" disabled={busy} aria-label={`Dismiss: ${s.value ?? s.name}`} onClick={() => onAction(s, 'dismiss')}>Dismiss</Button>
      </div>
    </li>)}
  </ul>;
}
