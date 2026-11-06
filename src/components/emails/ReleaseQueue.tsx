import { useRef, useState } from 'react';
import { Link } from 'react-router';
import {emailReleaseSummary,type EmailSendView} from '../../lib/emailVerification';
import { supabase } from '../../lib/supabase';
import { useDrafts } from '../../hooks/useDrafts';
import type { DraftLog } from '../../hooks/useDrafts';
import { useOrgLeads } from '../../hooks/useOrgLeads';
import {useReviewBatch} from '../../hooks/useReviewBatch';
import {ReviewBatchControls} from '../ui/ReviewBatchControls';
import {discardReviewDraft,releaseReviewDraft,reviewedDraftMatches} from '../../lib/draftReviewActions';
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
  const review=useReviewBatch(drafts.map(d=>d.id));
  const lock=useRef(false);const [checking,setChecking]=useState(false);
  const visible=drafts.filter(d=>!review.done.has(d.id));
  const [reviewing, setReviewing] = useState<DraftLog | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [report, setReport] = useState<PostSendReport | null>(null);
  const reviewLead = reviewing?.lead ? leads.find((l) => l.id === reviewing.lead!.id) ?? null : null;

  // A discard (or any other refresh) can drop a draft that's still checked
  // — without this, the "Release selected (N)" count and the header
  // checkbox's all-selected comparison both go stale, even though the
  // release loop itself only ever iterates `drafts` and so can't act on a
  // dead id.
  // useReviewBatch scopes selection to the current rows and retains failures.
  async function handleBatch(action:'release'|'reject') {
    if(lock.current||review.busy||reviewing||!review.selected.size)return;
    if(!window.confirm(action==='release'?'Send the selected reviewed drafts now?':'Reject selected drafts? This removes them from the review queue.'))return;
    lock.current=true;setChecking(true);
    try {
    setSummary(null);setReport(null);
    const reports:(PostSendReport|null)[]=[];const results:EmailSendView[]=[];
    // Recheck immediately before release: a draft may have acquired an Autopilot link since selection.
    const fresh=await loadReleaseDrafts(supabase,currentOrg?.id??null);
    if(fresh.error){setSummary(fresh.error);return;}
    const available=new Map(fresh.drafts.map(d=>[d.id,d]));
    await review.run(visible,d=>d.id,async draft=>{
      const current=available.get(draft.id);
      if(!current)return 'This draft changed or now requires Autopilot review. Refresh before trying again.';
      if(!reviewedDraftMatches(draft,current))return 'This draft changed after selection. Review it again before releasing or rejecting it.';
      if(action==='reject')return discardReviewDraft(supabase,current.id);
      const result=await releaseReviewDraft(supabase,current);results.push(result.view);
      if(!result.error){
        // Keep which lead each line is about: prefix with the business name (lines then stay distinct per lead).
        const rep=parsePostSend(result.data);const who=current.lead?.business_name??current.to_email;
        reports.push(rep?{lines:rep.lines.map(l=>`${who}: ${l}`),warnings:rep.warnings.map(w=>`${who}: ${w}`)}:null);
      }
      return result.error;
    },action==='release'?'Release':'Reject');
    setReport(mergePostSend(reports));
    if(action==='release')setSummary(emailReleaseSummary(results));
    await refresh();
    } catch(error) {console.error('release queue refresh failed',error);setSummary('Could not refresh the review queue. Refresh before trying again.');}
    finally {lock.current=false;setChecking(false);}
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Autopilot drafts need individual review. <Link className="underline" to="/outreach/autopilot">Review Autopilot drafts</Link></p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ReviewBatchControls review={{...review,busy:review.busy||checking||!!reviewing,summary:summary??review.summary}} ids={visible.map(d=>d.id)} approveLabel="Release selected" rejectLabel="Reject selected" onApprove={()=>void handleBatch('release')} onReject={()=>void handleBatch('reject')} />
      {report && <PostSendPreview lines={null} report={report} />}
      <EmailReviewQueue
        drafts={visible}
        loading={loading}
        onReview={setReviewing}
        onChanged={() => void refresh()}
        selected={review.selected}
        onToggle={review.toggle}
        onToggleAll={review.all}
        selectionDisabled={review.busy||checking||!!reviewing}
        errors={review.errors}
      />
      {reviewing && reviewLead && (
        <EmailComposer
          lead={reviewLead}
          open
          onClose={() => { setReviewing(null); void refresh(); }}
          draft={{ log_id: reviewing.id, template_id: reviewing.template_id, subject: reviewing.subject, body: reviewing.body, to_email: reviewing.to_email, decision_maker_candidate_id: reviewing.decision_maker_candidate_id, attachments: reviewing.attachments }}
        />
      )}
    </div>
  );
}
