import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { shouldEnrolAfterSend } from '../../lib/runLeadGroups';
import { fetchLogStatuses } from '../../hooks/useDraftStatuses';
import { useEnrollments } from '../../hooks/useEnrollments';
import { useAuth } from '../../hooks/useAuth';
import { EmailComposer } from '../emails/EmailComposer';
import type { EmailLog, Lead } from '../../types';

interface NeedsInputReviewProps {
  lead: Lead;
  log: EmailLog;
  /** Sequence the engine would have used; the lead is enrolled in it at step 2 once the draft is sent. */
  sequenceId: string | null;
  /** Called once the composer is closed and any follow-up work is finished; `error` is set if the follow-up failed; `sentConfirmed` is true only when the draft was confirmed sent. */
  onDone: (error: string | null, sentConfirmed: boolean) => void;
}

/**
 * Opens a parked autopilot draft in the standard email composer. When the composer closes and the
 * draft turns out to be sent, enrols the lead in the row's sequence at step 2 (unless it is already
 * enrolled, checked fresh) and leaves a lead note, once. A follow-up error is reported but never undoes the send.
 */
export function NeedsInputReview({ lead, log, sequenceId, onDone }: NeedsInputReviewProps) {
  const { session } = useAuth();
  const { enroll } = useEnrollments(lead.id);
  const [open, setOpen] = useState(true);
  const handled = useRef(false);

  async function handleClose() {
    if (handled.current) return;
    handled.current = true;
    setOpen(false);
    const { statuses, error: lookupErr } = await fetchLogStatuses([log.id]);
    if (lookupErr) { onDone(`Could not confirm the email was sent: ${lookupErr}`, false); return; }
    const logStatus = statuses.get(log.id);
    if (logStatus !== 'sent') { onDone(null, false); return; }
    const problems: string[] = [];
    if (sequenceId && shouldEnrolAfterSend({ logStatus, sequenceId, hasActiveEnrollment: false })) {
      const { data: existing, error: checkErr } = await supabase
        .from('sequence_enrollments').select('id').eq('lead_id', lead.id).in('status', ['active', 'paused']).limit(1);
      if (checkErr) problems.push(`Email sent, but: Could not check existing sequences: ${checkErr.message}`);
      else if (shouldEnrolAfterSend({ logStatus, sequenceId, hasActiveEnrollment: (existing ?? []).length > 0 })) {
        const err = await enroll(sequenceId, 2);
        if (err) problems.push(`Email sent, but the follow-up sequence could not be started: ${err}`);
      }
    }
    const { error: noteErr } = await supabase.from('lead_notes').insert({
      lead_id: lead.id, created_by: session?.user.id, note_type: 'general', content: `Autopilot email sent after review: ${log.subject}`,
    });
    if (noteErr) problems.push(`Email sent, but the lead note could not be saved: ${noteErr.message}`);
    onDone(problems.length > 0 ? problems.join(' ') : null, true);
  }

  return (
    <EmailComposer
      lead={lead}
      open={open}
      onClose={() => void handleClose()}
      draft={{ log_id: log.id, subject: log.subject, body: log.body, to_email: log.to_email, decision_maker_candidate_id: log.decision_maker_candidate_id, attachments: log.attachments }}
    />
  );
}
