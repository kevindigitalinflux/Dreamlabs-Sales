// Steps 7 to 9: save the draft, final safety re-check, reserve a slot, mark the send, send, and update the platform.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { classifyLead, endOfLocalDay, localDateString, type EligibilityEnrollment, type EligibilityLead } from '../autopilotEligibility.ts';
import { sendLeadEmail } from '../sendLeadEmail.ts';
import { skipReasonFor } from '../selectedAutopilotRules.ts';
import { firstSendBlock, followUpNote, isRecipientBlocked, nextEnrollmentState, plainReason, sameEnrolment, stepAlreadySent } from '../selectedLeadPipelineRules.ts';
import type { PipelineContext, PipelineOutcome } from '../selectedLeadPipeline.ts';
import type { Draft } from './draft.ts';
import type { Lead, Progress, SequenceRow } from './types.ts';

export interface Recipient { email: string; candidateId: string | null }

/** Inserts the draft as an email_logs row (status draft, same shape check-sequences uses). Null when it could not be saved. */
export async function insertDraftLog(ctx: PipelineContext, lead: Lead, recipient: Recipient, draft: Draft): Promise<string | null> {
  const { data, error } = await ctx.service.from('email_logs').insert({
    lead_id: lead.id, sent_by: ctx.run.created_by, to_email: recipient.email, subject: draft.subject, body: draft.body,
    status: 'draft', org_id: ctx.run.org_id, decision_maker_candidate_id: recipient.candidateId, attachments: draft.attachments,
  }).select('id').single();
  if (error) { console.error('autopilot: could not save draft'); return null; }
  return (data as { id: string }).id;
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const RECENT_EMAIL_DAYS = 14;

/**
 * One more check right before sending, failing CLOSED: any read error stops the send. Facts are gathered here and
 * decided in order by the pure firstSendBlock. Covers: lead still exists and is in this org, opted out / closed /
 * blocked / paused / not due (classifyLead), recipient address and domain blocklisted, the sequence enrolment is the
 * same one we started with, the same address was not emailed in the last 14 days (follow ups inside this lead's own
 * sequence are expected and ignored), no opted-out lead in the org owns this address, and a chosen decision maker
 * was not dismissed. Returns a skip reason, or the freshly read lead stage when it is fine to send.
 */
export async function lastMinuteCheck(ctx: PipelineContext, recipient: Recipient): Promise<{ skip: string } | { stage: string | null }> {
  const { service } = ctx;
  const failed = (what: string) => ({ skip: `Could not check ${what}` });
  const { data, error: leadErr } = await service.from('leads').select('*').eq('id', ctx.lead.id).maybeSingle();
  if (leadErr) return failed('this lead');
  const lead = data as (Record<string, unknown> & { org_id: string }) | null;
  const { data: bl, error: blErr } = await service.from('outreach_blocklist').select('value').eq('org_id', ctx.run.org_id);
  if (blErr) return failed('the blocklist');
  const blocked = new Set<string>((bl ?? []).map((b) => String((b as { value: string }).value)));
  const { data: enr, error: enrErr } = await service.from('sequence_enrollments').select('*')
    .eq('lead_id', ctx.lead.id).in('status', ['active', 'paused']).order('created_at', { ascending: false }).limit(1);
  if (enrErr) return failed("this lead's sequence status");
  const enrollment = ((enr ?? [])[0] ?? null) as (EligibilityEnrollment & { id?: string; current_step?: number }) | null;

  const since = new Date(Date.now() - RECENT_EMAIL_DAYS * 86_400_000).toISOString();
  const { data: sent, error: sentErr } = await service.from('email_logs').select('lead_id')
    .eq('org_id', ctx.run.org_id).eq('status', 'sent').gte('sent_at', since).ilike('to_email', escapeLike(recipient.email)).limit(20);
  if (sentErr) return failed('recent emails to this address');
  const { count: optedOut, error: ooErr } = await service.from('leads').select('id', { count: 'exact', head: true })
    .eq('org_id', ctx.run.org_id).eq('opted_out', true).neq('id', ctx.lead.id).ilike('email', escapeLike(recipient.email));
  if (ooErr) return failed('opt outs for this address');
  // Has this enrolment's current step already been sent? (the advance may not have landed)
  let stepSent = false;
  if (ctx.enrollment?.id) {
    const { count: linked, error: lErr } = await service.from('email_logs').select('id', { count: 'exact', head: true })
      .eq('sequence_enrollment_id', ctx.enrollment.id).eq('status', 'sent');
    if (lErr) return failed('which steps were already sent');
    stepSent = stepAlreadySent(linked ?? 0, ctx.enrollment.current_step ?? 1);
  }
  let candidateRemoved = false;
  if (recipient.candidateId) {
    const { data: cand, error: cErr } = await service.from('decision_maker_candidates').select('dismissed_at').eq('id', recipient.candidateId).maybeSingle();
    if (cErr) return failed('the chosen decision maker');
    candidateRemoved = !cand || !!(cand as { dismissed_at: string | null }).dismissed_at;
  }

  const now = new Date();
  const verdict = lead ? classifyLead(lead as unknown as EligibilityLead, enrollment, blocked, endOfLocalDay(now, ctx.run.timezone), now) : null;
  const block = firstSendBlock({
    leadFound: !!lead, sameOrg: lead?.org_id === ctx.run.org_id,
    ineligibleReason: verdict && !verdict.eligible ? verdict.reason : null,
    recipientBlocked: isRecipientBlocked(recipient.email, blocked),
    enrolmentChanged: !sameEnrolment(ctx.enrollment, enrollment), stepAlreadySent: stepSent,
    // Earlier steps of this lead's own sequence are expected (stepAlreadySent above catches a replay); anything else sent to this address is not.
    recentlyEmailed: ((sent ?? []) as { lead_id: string | null }[]).some((r) => !(ctx.enrollment && r.lead_id === ctx.lead.id)),
    optedOutLeadHasAddress: (optedOut ?? 0) > 0, candidateRemoved,
  }, skipReasonFor);
  if (block) return { skip: block };
  return { stage: (lead!.stage as string | null) ?? null };
}

/** Records the outcome of the platform updates after a send. Each part is best effort: the email already went out. */
export async function recordSendEffects(service: SupabaseClient, ctx: PipelineContext, sequence: SequenceRow, step: number, subject: string, emailLogId: string): Promise<void> {
  const leadId = ctx.lead.id;
  try {
    const { error } = await service.from('lead_notes').insert({ lead_id: leadId, created_by: ctx.run.created_by, note_type: 'general', content: `Autopilot sent email: ${subject}` });
    if (error) console.error('autopilot: could not add sent note');
  } catch { console.error('autopilot: could not add sent note'); }

  let next: ReturnType<typeof nextEnrollmentState> | null = null;
  let enrolmentId: string | null = ctx.enrollment?.id ?? null;
  try {
    next = nextEnrollmentState(step, sequence.steps, new Date());
    if (ctx.enrollment) {
      if (!enrolmentId) console.error('autopilot: no enrolment id to update');
      else {
        // Conditional so a change made during the send (someone paused or moved the enrolment) is left as is.
        const { data, error } = await service.from('sequence_enrollments').update(next)
          .eq('id', enrolmentId).eq('current_step', step).eq('status', 'active').select('id');
        if (error) console.error('autopilot: could not update the sequence enrolment');
        else if (!data || data.length === 0) { console.error('autopilot: enrolment changed during send, left as is'); next = null; }
      }
    } else {
      const { data, error } = await service.from('sequence_enrollments')
        .insert({ lead_id: leadId, sequence_id: sequence.id, ...next, enrolled_by: ctx.run.created_by }).select('id').single();
      if (error) console.error('autopilot: could not create the sequence enrolment');
      else enrolmentId = (data as { id: string }).id;
    }
  } catch { console.error('autopilot: could not update the sequence enrolment'); }

  // Link the sent email to the enrolment so a reply to it is detected and pauses the sequence (check-replies).
  try {
    if (enrolmentId) {
      const { error } = await service.from('email_logs').update({ sequence_enrollment_id: enrolmentId }).eq('id', emailLogId);
      if (error) console.error('autopilot: could not link the email to its enrolment');
    }
  } catch { console.error('autopilot: could not link the email to its enrolment'); }

  try {
    if (next && next.status === 'active' && next.next_send_at) {
      const { error } = await service.from('leads').update({
        next_action_date: localDateString(new Date(next.next_send_at), ctx.run.timezone),
        next_action_note: followUpNote(next.current_step, sequence.steps.length),
      }).eq('id', leadId);
      if (error) console.error('autopilot: could not set the follow up');
    }
  } catch { console.error('autopilot: could not set the follow up'); }
}

/**
 * Reserve a slot, mark the send, send, and record. Call only after every draft and safety check passed.
 * Once markSendStarted has been called nothing here gives up or releases the slot except a clean `ok: false`.
 */
export async function sendDraft(
  ctx: PipelineContext, lead: Lead, stage: string | null, recipient: Recipient, draft: Draft, emailLogId: string, sequence: SequenceRow, step: number, progress: Progress,
): Promise<PipelineOutcome> {
  const base = { emailLogId, sequenceId: sequence.id, costCents: progress.costCents };
  try {
    await ctx.markSendStarted(emailLogId);
  } catch {
    await ctx.releaseSend();
    return { outcome: 'failed', reason: 'Could not record send start; did not send', ...base };
  }
  progress.sendStarted = true;

  const result = await sendLeadEmail(ctx.service, {
    senderId: ctx.run.created_by, to: recipient.email, subject: draft.subject, body: draft.body,
    leadId: lead.id, logId: emailLogId, decisionMakerCandidateId: recipient.candidateId, attachments: draft.attachments,
    orgId: ctx.run.org_id, leadStage: stage,
    draft: { org_id: ctx.run.org_id, attachments: draft.attachments },
  });
  if (!result.ok) {
    await ctx.releaseSend();
    return { outcome: 'failed', reason: plainReason(result.error), ...base };
  }
  if (result.warning) {
    // Sent but the log row may still say draft; fix it so a person cannot release it a second time.
    try {
      const { error } = await ctx.service.from('email_logs').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', emailLogId);
      if (error) console.error('autopilot: could not mark the sent email as sent');
    } catch { console.error('autopilot: could not mark the sent email as sent'); }
  }
  try { await recordSendEffects(ctx.service, ctx, sequence, step, draft.subject, emailLogId); } catch { console.error('autopilot: platform updates failed after send'); }
  return { outcome: 'sent', emailLogId, sequenceId: sequence.id, costCents: progress.costCents };
}
