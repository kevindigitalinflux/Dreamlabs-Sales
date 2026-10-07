// Steps 7 to 9: save the draft, final safety re-check, reserve a slot, mark the send, send, and update the platform.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { classifyLead, endOfLocalDay, type EligibilityEnrollment, type EligibilityLead } from '../autopilotEligibility.ts';
import { sendLeadEmail } from '../sendLeadEmail.ts';
import { skipReasonFor } from '../selectedAutopilotRules.ts';
import { followUpNote, isRecipientBlocked, nextEnrollmentState, plainReason } from '../selectedLeadPipelineRules.ts';
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

/**
 * One more cheap check right before sending: the lead reloaded (still in this org, not opted out, not blocked, still
 * eligible), the recipient address and domain not on the blocklist, and a chosen decision-maker not dismissed since.
 * Returns a skip reason, or the freshly read lead stage when it is still fine to send.
 */
export async function lastMinuteCheck(ctx: PipelineContext, recipient: Recipient): Promise<{ skip: string } | { stage: string | null }> {
  const { data } = await ctx.service.from('leads').select('*').eq('id', ctx.lead.id).maybeSingle();
  const lead = data as (Record<string, unknown> & { org_id: string }) | null;
  if (!lead) return { skip: 'Lead no longer exists' };
  if (lead.org_id !== ctx.run.org_id) return { skip: 'Lead is not in this organization' };
  const { data: bl } = await ctx.service.from('outreach_blocklist').select('value').eq('org_id', ctx.run.org_id);
  const blocked = new Set<string>((bl ?? []).map((b) => String((b as { value: string }).value)));
  const { data: enr } = await ctx.service.from('sequence_enrollments').select('*')
    .eq('lead_id', ctx.lead.id).in('status', ['active', 'paused']).order('created_at', { ascending: false }).limit(1);
  const enrollment = ((enr ?? [])[0] ?? null) as EligibilityEnrollment | null;
  const now = new Date();
  const verdict = classifyLead(lead as unknown as EligibilityLead, enrollment, blocked, endOfLocalDay(now, ctx.run.timezone), now);
  if (!verdict.eligible) return { skip: skipReasonFor(verdict.reason) };
  if (isRecipientBlocked(recipient.email, blocked)) return { skip: skipReasonFor('blocked') };
  if (recipient.candidateId) {
    const { data: cand } = await ctx.service.from('decision_maker_candidates').select('dismissed_at').eq('id', recipient.candidateId).maybeSingle();
    if (!cand || (cand as { dismissed_at: string | null }).dismissed_at) return { skip: 'The chosen decision maker was removed' };
  }
  return { stage: (lead.stage as string | null) ?? null };
}

/** Records the outcome of the platform updates after a send. Each part is best effort: the email already went out. */
export async function recordSendEffects(service: SupabaseClient, ctx: PipelineContext, sequence: SequenceRow, step: number, subject: string): Promise<void> {
  const leadId = ctx.lead.id;
  try {
    const { error } = await service.from('lead_notes').insert({ lead_id: leadId, created_by: ctx.run.created_by, note_type: 'general', content: `Autopilot sent email: ${subject}` });
    if (error) console.error('autopilot: could not add sent note');
  } catch { console.error('autopilot: could not add sent note'); }

  let next: ReturnType<typeof nextEnrollmentState> | null = null;
  try {
    next = nextEnrollmentState(step, sequence.steps, new Date());
    const existingId = ctx.enrollment?.id;
    const { error } = ctx.enrollment
      ? (existingId ? await service.from('sequence_enrollments').update(next).eq('id', existingId) : { error: new Error('no enrolment id') })
      : await service.from('sequence_enrollments').insert({ lead_id: leadId, sequence_id: sequence.id, ...next, enrolled_by: ctx.run.created_by });
    if (error) console.error('autopilot: could not update the sequence enrolment');
  } catch { console.error('autopilot: could not update the sequence enrolment'); }

  try {
    if (next && next.status === 'active' && next.next_send_at) {
      const { error } = await service.from('leads')
        .update({ next_action_date: next.next_send_at.slice(0, 10), next_action_note: followUpNote(next.current_step, sequence.steps.length) }).eq('id', leadId);
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
    const { error } = await ctx.service.from('email_logs').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', emailLogId);
    if (error) console.error('autopilot: could not mark the sent email as sent');
  }
  try { await recordSendEffects(ctx.service, ctx, sequence, step, draft.subject); } catch { console.error('autopilot: platform updates failed after send'); }
  return { outcome: 'sent', emailLogId, sequenceId: sequence.id, costCents: progress.costCents };
}
