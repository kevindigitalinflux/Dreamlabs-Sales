import { useRef, useState } from 'react';
import {finishParkedDraft} from '../../lib/finishParkedDraft';
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
 * draft turns out to be sent, moves an existing active enrolment on a step (when the draft was its current step) or enrols the lead in the row's sequence at step 2 (checked fresh) and leaves a lead note, once. A follow-up error is reported but never undoes the send.
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
    try {const result=await finishParkedDraft(lead,log,sequenceId,session?.user.id,enroll);onDone(result.error,result.sent);}
    catch(error){console.error('parked draft follow-up failed',error);onDone('Could not finish the sent-email follow-up. Check the lead before sending again.',false);}
  }

  return (
    <EmailComposer
      lead={lead}
      open={open}
      onClose={() => void handleClose()}
      draft={{ log_id: log.id, template_id: log.template_id, subject: log.subject, body: log.body, to_email: log.to_email, decision_maker_candidate_id: log.decision_maker_candidate_id, attachments: log.attachments }}
    />
  );
}
