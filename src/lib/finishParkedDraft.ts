import {supabase} from './supabase';
import {enrolmentActionAfterSend} from './runLeadGroups';
import {advanceEnrollment} from './sequenceMath';
import {fetchLogStatuses} from '../hooks/useDraftStatuses';
import type {EmailLog,Lead,SequenceStep} from '../types';
/** Shared reviewed-send follow-up. A follow-up error never undoes or retries the send. */
export async function finishParkedDraft(lead:Lead,log:EmailLog,sequenceId:string|null,userId:string|undefined,enroll:(id:string,step:number)=>Promise<string|null>) {
    const { statuses, error: lookupErr } = await fetchLogStatuses([log.id]);
    if (lookupErr) { return {error:`Could not confirm the email was sent: ${lookupErr}`,sent:false}; }
    const logStatus = statuses.get(log.id);
    if (logStatus !== 'sent') { return {error:null,sent:false}; }
    const problems: string[] = [];
    const { data: existing, error: checkErr } = await supabase
      .from('sequence_enrollments').select('id, status, current_step, sequence:email_sequences(steps)')
      .eq('lead_id', lead.id).in('status', ['active', 'paused']).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (checkErr) problems.push(`Email sent, but: Could not check existing sequences: ${checkErr.message}`);
    else {
      const row = existing as { id: string; status: string; current_step: number; sequence: { steps: SequenceStep[] } | null } | null;
      const action = enrolmentActionAfterSend({ logStatus, sequenceId, logEnrollmentId: log.sequence_enrollment_id, existing: row });
      if (action === 'advance' && row?.sequence) {
        // Same advance logic as the engine; conditional so a change made elsewhere is left as is.
        const next = advanceEnrollment({ current_step: row.current_step }, row.sequence.steps, new Date());
        const { error } = await supabase.from('sequence_enrollments').update(next)
          .eq('id', row.id).eq('current_step', row.current_step).eq('status', 'active');
        if (error) problems.push(`Email sent, but the sequence could not be moved on: ${error.message}`);
      } else if (action === 'enrol' && sequenceId) {
        const err = await enroll(sequenceId, 2);
        if (err) problems.push(`Email sent, but the follow-up sequence could not be started: ${err}`);
        else {
          // Link the sent email to the new enrolment so replies are detected and the step is counted as sent.
          const { data: created } = await supabase.from('sequence_enrollments').select('id')
            .eq('lead_id', lead.id).eq('sequence_id', sequenceId).order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (created) {
            const { error: linkErr } = await supabase.from('email_logs').update({ sequence_enrollment_id: (created as { id: string }).id }).eq('id', log.id);
            if (linkErr) problems.push(`Email sent, but it could not be linked to the sequence: ${linkErr.message}`);
          }
        }
      }
    }
    const { error: noteErr } = await supabase.from('lead_notes').insert({
      lead_id: lead.id, created_by: userId, note_type: 'general', content: `Autopilot email sent after review: ${log.subject}`,
    });
    if (noteErr) problems.push(`Email sent, but the lead note could not be saved: ${noteErr.message}`);
    return {error:problems.length>0?problems.join(' '):null,sent:true};
}
