import { useEffect, useState } from 'react';
import { readableInvokeError } from '../../lib/invokeError';
import { supabase } from '../../lib/supabase';
import { useDrafts } from '../../hooks/useDrafts';
import type { DraftLog } from '../../hooks/useDrafts';
import { useOrgLeads } from '../../hooks/useOrgLeads';
import { Button } from '../ui/Button';
import { EmailReviewQueue } from '../dashboard/EmailReviewQueue';
import { EmailComposer } from './EmailComposer';

/**
 * Same underlying draft queue as the Dashboard's "Emails ready to review"
 * card, but with multi-select + bulk "Release" for working through a
 * larger batch — an additional way to act on many drafts at once, not a
 * replacement for the Dashboard's quick one-by-one triage.
 */
export function ReleaseQueue() {
  const { drafts, loading, refresh } = useDrafts();
  const { leads } = useOrgLeads();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<DraftLog | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const reviewLead = reviewing?.lead ? leads.find((l) => l.id === reviewing.lead!.id) ?? null : null;

  // A discard (or any other refresh) can drop a draft that's still checked
  // — without this, the "Release selected (N)" count and the header
  // checkbox's all-selected comparison both go stale, even though the
  // release loop itself only ever iterates `drafts` and so can't act on a
  // dead id.
  useEffect(() => {
    setSelected((prev) => {
      const draftIds = new Set(drafts.map((d) => d.id));
      const next = new Set([...prev].filter((id) => draftIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [drafts]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === drafts.length ? new Set() : new Set(drafts.map((d) => d.id))));
  }

  async function handleRelease() {
    setReleasing(true);
    setSummary(null);
    let sent = 0;
    let failed = 0;
    let firstFailReason: string | null = null;
    for (const draft of drafts) {
      if (!selected.has(draft.id)) continue;
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: { to_email: draft.to_email, subject: draft.subject, body: draft.body, lead_id: draft.lead?.id, log_id: draft.id },
      });
      const result = data as { ok?: boolean; error?: string } | null;
      if (error || !result?.ok) {
        failed++;
        if (!firstFailReason) firstFailReason = error ? await readableInvokeError(error) : (result?.error ?? 'Send failed');
      } else {
        sent++;
      }
    }
    setReleasing(false);
    setSelected(new Set());
    setSummary(failed === 0 ? `Sent ${sent}` : `Sent ${sent} — ${failed} failed${firstFailReason ? `: ${firstFailReason}` : ''}`);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="flex items-center justify-end">
          <Button onClick={() => void handleRelease()} disabled={releasing}>
            {releasing ? 'Releasing…' : `Release selected (${selected.size})`}
          </Button>
        </div>
      )}
      {summary && <p role="status" className="text-sm text-success">{summary}</p>}
      <EmailReviewQueue
        drafts={drafts}
        loading={loading}
        onReview={setReviewing}
        onChanged={() => void refresh()}
        selected={selected}
        onToggle={toggleSelected}
        onToggleAll={toggleSelectAll}
        selectionDisabled={releasing}
      />
      {reviewing && reviewLead && (
        <EmailComposer
          lead={reviewLead}
          open
          onClose={() => { setReviewing(null); void refresh(); }}
          draft={{ log_id: reviewing.id, subject: reviewing.subject, body: reviewing.body }}
        />
      )}
    </div>
  );
}
