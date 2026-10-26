import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { readableInvokeError } from '../../lib/invokeError';
import { supabase } from '../../lib/supabase';
import { useDrafts } from '../../hooks/useDrafts';
import type { DraftLog } from '../../hooks/useDrafts';
import { useOrgLeads } from '../../hooks/useOrgLeads';
import { Button } from '../ui/Button';
import { EmailReviewQueue } from '../dashboard/EmailReviewQueue';
import { EmailComposer } from './EmailComposer';
import { PostSendPreview } from './PostSendPreview';
import { mergePostSend, parsePostSend } from '../../lib/postSendPreview';
import type { PostSendReport } from '../../lib/postSendPreview';
import { useOrg } from '../../hooks/useOrg';
import { loadReleaseDrafts } from '../../lib/releaseDrafts';

/**
 * Same underlying draft queue as the Dashboard's "Emails ready to review"
 * card, but with multi-select + bulk "Release" for working through a
 * larger batch — an additional way to act on many drafts at once, not a
 * replacement for the Dashboard's quick one-by-one triage.
 */
export function ReleaseQueue() {
  const { drafts, loading, error, refresh } = useDrafts(true);
  const { currentOrg } = useOrg();
  const { leads } = useOrgLeads();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<DraftLog | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [report, setReport] = useState<PostSendReport | null>(null);
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
    setReport(null);
    const reports: (PostSendReport | null)[] = [];
    let sent = 0;
    let failed = 0;
    let firstFailReason: string | null = null;
    // Recheck immediately before release: a draft may have acquired an Autopilot link since selection.
    const fresh = await loadReleaseDrafts(supabase, currentOrg?.id ?? null);
    if (fresh.error) { setSummary(fresh.error); setReleasing(false); return; }
    for (const draft of fresh.drafts) {
      if (!selected.has(draft.id)) continue;
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          to_email: draft.to_email, subject: draft.subject, body: draft.body, lead_id: draft.lead?.id, log_id: draft.id,
          decision_maker_candidate_id: draft.decision_maker_candidate_id,
        },
      });
      const result = data as { ok?: boolean; error?: string } | null;
      if (error || !result?.ok) {
        failed++;
        if (!firstFailReason) firstFailReason = error ? await readableInvokeError(error) : (result?.error ?? 'Send failed');
      } else {
        sent++;
        // Keep which lead each line is about: prefix with the business name (lines then stay distinct per lead).
        const rep = parsePostSend(data);
        const who = draft.lead?.business_name ?? draft.to_email;
        reports.push(rep ? { lines: rep.lines.map((l) => `${who}: ${l}`), warnings: rep.warnings.map((w) => `${who}: ${w}`) } : null);
      }
    }
    setReleasing(false);
    setReport(mergePostSend(reports));
    setSelected(new Set());
    setSummary(failed === 0 ? `Sent ${sent}` : `Sent ${sent} — ${failed} failed${firstFailReason ? `: ${firstFailReason}` : ''}`);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Autopilot drafts need individual review. <Link className="underline" to="/outreach/autopilot">Review Autopilot drafts</Link></p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {selected.size > 0 && (
        <div className="flex items-center justify-end">
          <Button onClick={() => void handleRelease()} disabled={releasing} loading={releasing}>
            {releasing ? 'Releasing…' : `Release selected (${selected.size})`}
          </Button>
        </div>
      )}
      {summary && <p role="status" className="text-sm text-success">{summary}</p>}
      {report && <PostSendPreview lines={null} report={report} />}
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
          draft={{ log_id: reviewing.id, subject: reviewing.subject, body: reviewing.body, to_email: reviewing.to_email, decision_maker_candidate_id: reviewing.decision_maker_candidate_id, attachments: reviewing.attachments }}
        />
      )}
    </div>
  );
}
