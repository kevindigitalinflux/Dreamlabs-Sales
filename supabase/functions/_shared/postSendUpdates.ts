// Applies the platform updates that follow a successful MANUAL send (note, sequence enrol/advance, follow-up date).
// Called only from the send-email handler (never from sendLeadEmail, so autopilot sends are not double counted).
// Every step is wrapped: a failing step becomes a warning and never throws out of applyPostSendUpdates.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { localDateString } from './autopilotEligibility.ts';
import { isUniqueViolation } from './enrollmentErrors.ts';
import {
  buildDefaultTemplateIdByType, cleanSubject, decidePostSend, describePostSend, isEarlierSendInWindow,
  type EnrollmentLike, type PostSendDecision, type SequenceLike, type TemplateRef, type VisibleTemplate,
} from './postSendRules.ts';

/** What the handler knows about the send that just succeeded. */
export interface PostSendContext {
  orgId: string;
  leadId: string;
  logId: string;
  userId: string;
  subject: string;
  toEmail: string;
  recipientLabel: string;
  /** Fallback only: the log row's own template_id wins. */
  templateId: string | null;
  /** IANA zone for "today"; default Europe/London. */
  timezone?: string;
}

/** Outcome: plain-English summary lines for the user and any warnings. */
export interface PostSendResult { ok: boolean; lines: string[]; warnings: string[] }

type Service = SupabaseClient;
interface EnrollmentRow extends EnrollmentLike { id: string }
const FAIL_CLOSED = 'Follow-up updates were skipped because the email record could not be verified';

/**
 * Applies the post-send decision for one sent email. Never throws. `ok` is false when anything could not be applied
 * (the email itself was already sent; the warnings say what to check).
 */
export async function applyPostSendUpdates(service: Service, ctx: PostSendContext): Promise<PostSendResult> {
  const warnings: string[] = [];
  try {
    return await run(service, ctx, warnings);
  } catch {
    warnings.push('Follow-up updates could not be completed');
    return { ok: false, lines: [], warnings };
  }
}

async function run(service: Service, ctx: PostSendContext, warnings: string[]): Promise<PostSendResult> {
  // 1. The log must be this lead's and this org's, or nothing is touched.
  const { data: log, error: logErr } = await service.from('email_logs')
    .select('id, lead_id, org_id, template_id, sequence_enrollment_id, sent_at').eq('id', ctx.logId).maybeSingle();
  const logRow = log as { lead_id: string | null; org_id: string | null; template_id: string | null; sequence_enrollment_id: string | null; sent_at: string | null } | null;
  if (logErr || !logRow || logRow.lead_id !== ctx.leadId || logRow.org_id !== ctx.orgId) return { ok: false, lines: [], warnings: [FAIL_CLOSED] };

  const { data: lead, error: leadErr } = await service.from('leads')
    .select('id, org_id, next_action_date').eq('id', ctx.leadId).maybeSingle();
  const leadRow = lead as { id: string; org_id: string; next_action_date: string | null } | null;
  if (leadErr || !leadRow || leadRow.org_id !== ctx.orgId) return { ok: false, lines: [], warnings: [FAIL_CLOSED] };

  const [enrRes, seqRes, tplRes] = await Promise.all([
    service.from('sequence_enrollments').select('id, sequence_id, current_step, status, next_send_at')
      .eq('lead_id', ctx.leadId).in('status', ['active', 'paused']).order('created_at', { ascending: false }).limit(1),
    service.from('email_sequences').select('id, name, steps').or(`org_id.eq.${ctx.orgId},org_id.is.null`).eq('is_active', true),
    service.from('email_templates').select('id, org_id, template_type, is_default').or(`org_id.eq.${ctx.orgId},org_id.is.null`),
  ]);
  if (enrRes.error || seqRes.error || tplRes.error) {
    warnings.push('Sequence and follow-up updates were skipped because the sequence data could not be read');
    await addNote(service, ctx, `Email sent: ${cleanSubject(ctx.subject)} (to ${ctx.recipientLabel})`, warnings);
    return { ok: false, lines: [], warnings };
  }
  const enrollment = ((enrRes.data ?? [])[0] ?? null) as EnrollmentRow | null;
  const sequences = (seqRes.data ?? []) as SequenceLike[];
  const templates = (tplRes.data ?? []) as VisibleTemplate[];

  const templateId = logRow.template_id ?? ctx.templateId;
  const tplRow = templateId ? templates.find((t) => t.id === templateId) : undefined;
  const template: TemplateRef | null = tplRow ? { id: tplRow.id, template_type: tplRow.template_type, is_default: tplRow.is_default } : null;

  // Repeat-send guard: another email for this lead with the same template went out in the last 6 hours, so the
  // sequence has already been moved for it (stops two consecutive steps that share a template advancing twice).
  // Fails safe: if the check cannot be read, assume it was already applied and do not move the sequence.
  let alreadyApplied = false;
  if (templateId) {
    const WINDOW = 6 * 3600_000;
    const mine = { id: ctx.logId, sent_at: logRow.sent_at };
    const since = new Date((logRow.sent_at ? new Date(logRow.sent_at).getTime() : Date.now()) - WINDOW).toISOString();
    // Only EARLIER sends count (see isEarlierSendInWindow), so two overlapping post-sends cannot skip each other forever.
    const { data: recent, error: recentErr } = await service.from('email_logs').select('id, sent_at')
      .eq('lead_id', ctx.leadId).eq('status', 'sent').eq('template_id', templateId).neq('id', ctx.logId).gte('sent_at', since).limit(50);
    if (recentErr || !logRow.sent_at) { alreadyApplied = true; warnings.push('Sequence step was not moved because recent emails could not be checked'); }
    else alreadyApplied = ((recent ?? []) as { id: string; sent_at: string | null }[]).some((o) => isEarlierSendInWindow(o, mine, WINDOW));
  }

  const now = new Date();
  const tz = ctx.timezone ?? 'Europe/London';
  const toLocalDate = (iso: string) => localDateString(new Date(iso), tz);
  const decision = decidePostSend({
    templateId: template ? templateId : null, template, enrollment, sequences,
    defaultTemplateIdByType: buildDefaultTemplateIdByType(templates, ctx.orgId),
    logLinkedToEnrollment: !!logRow.sequence_enrollment_id,
    logEnrollmentId: logRow.sequence_enrollment_id,
    alreadyAppliedForTemplate: alreadyApplied,
    currentNextActionDate: leadRow.next_action_date,
    todayLocal: localDateString(now, tz), now, subject: ctx.subject, recipientLabel: ctx.recipientLabel, toLocalDate,
  });

  await addNote(service, ctx, decision.note, warnings);
  const described = describePostSend(decision);
  const seq = await applySequence(service, ctx, decision, logRow.sequence_enrollment_id, warnings);
  const nextSet = seq.allowNextAction && await applyNextAction(service, ctx, decision, tz, warnings);
  const lines = [
    seq.applied ? described[0]! : 'No sequence change',
    nextSet ? `Follow-up set for ${decision.nextAction.date}` : 'Your existing next action date is kept',
  ];
  return { ok: warnings.length === 0, lines, warnings };
}

async function addNote(service: Service, ctx: PostSendContext, content: string, warnings: string[]): Promise<void> {
  try {
    const { error } = await service.from('lead_notes').insert({ lead_id: ctx.leadId, created_by: ctx.userId, note_type: 'general', content });
    if (error) warnings.push('The note about this email could not be added');
  } catch { warnings.push('The note about this email could not be added'); }
}

async function linkLog(service: Service, ctx: PostSendContext, enrollmentId: string, warnings: string[]): Promise<void> {
  try {
    const { error } = await service.from('email_logs').update({ sequence_enrollment_id: enrollmentId })
      .eq('id', ctx.logId).is('sequence_enrollment_id', null);
    if (error) warnings.push('The email could not be linked to its sequence, so a reply may not pause it');
  } catch { warnings.push('The email could not be linked to its sequence, so a reply may not pause it'); }
}

/** Sequence part of the decision. `allowNextAction` is false when a sequence change was meant but did not happen. */
async function applySequence(
  service: Service, ctx: PostSendContext, d: PostSendDecision, linkedAlready: string | null, warnings: string[],
): Promise<{ applied: boolean; allowNextAction: boolean }> {
  try {
    if (d.action === 'none') return { applied: false, allowNextAction: true };
    if (d.action === 'link_only') {
      if (d.enrollmentId && !linkedAlready) await linkLog(service, ctx, d.enrollmentId, warnings);
      return { applied: true, allowNextAction: true };
    }
    const next = { current_step: d.newCurrentStep, next_send_at: d.nextSendAt ?? null, status: d.newStatus };
    if (d.action === 'advance') {
      const { data, error } = await service.from('sequence_enrollments').update(next)
        .eq('id', d.enrollmentId!).eq('current_step', d.expectedCurrentStep!).eq('status', 'active').select('id');
      if (error) { warnings.push('The sequence could not be updated'); return { applied: false, allowNextAction: false }; }
      if (!data || data.length === 0) { warnings.push('Sequence position changed while sending, left as is'); return { applied: false, allowNextAction: false }; }
      await linkLog(service, ctx, d.enrollmentId!, warnings);
      return { applied: true, allowNextAction: true };
    }
    // enrol: re-check that the lead still has no active or paused enrolment.
    const { data: existing, error: exErr } = await service.from('sequence_enrollments').select('id')
      .eq('lead_id', ctx.leadId).in('status', ['active', 'paused']).limit(1);
    if (exErr) { warnings.push('The sequence could not be checked, so the lead was not enrolled'); return { applied: false, allowNextAction: false }; }
    if (existing && existing.length > 0) { warnings.push('The lead was enrolled in a sequence while sending, left as is'); return { applied: false, allowNextAction: false }; }
    const { data: ins, error: insErr } = await service.from('sequence_enrollments')
      .insert({ lead_id: ctx.leadId, sequence_id: d.sequenceId, ...next, enrolled_by: ctx.userId }).select('id').single();
    if (insErr && isUniqueViolation(insErr)) { warnings.push('The lead was enrolled in a sequence while sending, left as is'); return { applied: false, allowNextAction: false }; }
    if (insErr || !ins) { warnings.push('The lead could not be enrolled in the sequence'); return { applied: false, allowNextAction: false }; }
    await linkLog(service, ctx, (ins as { id: string }).id, warnings);
    return { applied: true, allowNextAction: true };
  } catch {
    warnings.push('The sequence could not be updated');
    return { applied: false, allowNextAction: false };
  }
}

/** Sets the follow-up only when the lead's date is still empty or past (re-read now) and unchanged at write time. */
async function applyNextAction(service: Service, ctx: PostSendContext, d: PostSendDecision, tz: string, warnings: string[]): Promise<boolean> {
  if (!d.nextAction.set || !d.nextAction.date) return false;
  try {
    const { data: cur, error } = await service.from('leads').select('next_action_date').eq('id', ctx.leadId).eq('org_id', ctx.orgId).maybeSingle();
    if (error || !cur) { warnings.push('The follow-up date could not be set'); return false; }
    const current = (cur as { next_action_date: string | null }).next_action_date;
    const curYmd = current?.trim().slice(0, 10) ?? '';
    if (curYmd !== '' && curYmd > localDateString(new Date(), tz)) return false;
    let q = service.from('leads').update({ next_action_date: d.nextAction.date, next_action_note: d.nextAction.note })
      .eq('id', ctx.leadId).eq('org_id', ctx.orgId);
    q = current === null ? q.is('next_action_date', null) : q.eq('next_action_date', current);
    const { data: upd, error: updErr } = await q.select('id');
    if (updErr) { warnings.push('The follow-up date could not be set'); return false; }
    return !!upd && upd.length > 0;
  } catch { warnings.push('The follow-up date could not be set'); return false; }
}
