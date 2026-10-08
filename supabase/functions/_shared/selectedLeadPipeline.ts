// The real per-lead pipeline for the selected-leads autopilot (Task 12b).
// Safety first: whenever there is doubt the lead is parked (needs_input) or skipped with a plain reason. Never send on uncertainty.
import { markLogInterrupted } from './interruptedSend.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { RESEARCH_COST_CENTS, researchLead } from './leadResearch.ts';
import { isEmptyResearch } from './researchPages.ts';
import type { EligibilityEnrollment } from './autopilotEligibility.ts';
import { canSendNow, hasStrayPlaceholder, placeholderReason, plainReason, unfilledPlaceholderNames } from './selectedLeadPipelineRules.ts';
import { buildDraft, type Draft } from './selectedLeadSteps/draft.ts';
import { creatorCanSend, loadNotes, loadOrgContext, loadSequencesAndTemplates } from './selectedLeadSteps/load.ts';
import { ensureRecipient } from './selectedLeadSteps/recipient.ts';
import { chooseSequence } from './selectedLeadSteps/sequence.ts';
import { insertDraftLog, lastMinuteCheck, sendDraft, type Recipient } from './selectedLeadSteps/send.ts';
import { TIMEOUT_REASON, isStop, raceDeadline, type Lead, type Progress } from './selectedLeadSteps/types.ts';

export interface PipelineRun {
  id: string; org_id: string; created_by: string; timezone: string;
}

export interface PipelineContext {
  service: SupabaseClient;
  run: PipelineRun;
  /** The lead freshly reloaded from the database; its org_id has already been verified against run.org_id. */
  lead: Record<string, unknown> & { id: string; org_id: string };
  /** Latest active/paused enrolment for the lead, if any. */
  enrollment: (EligibilityEnrollment & { id?: string; sequence_id?: string; current_step?: number }) | null;
  now: Date;
  /**
   * Absolute soft deadline (epoch ms, ~75s after this lead started). Abort research / AI steps once it passes
   * (return needs_input/failed with a reason). NEVER abort once SMTP has started: finish the send and record it.
   */
  deadlineMs: number;
  /**
   * MUST be called immediately before SMTP. Sets send_started_at (and email_log_id when known) on the run-lead row.
   * Rejects if the marker could not be saved: do NOT send in that case, and if reserveSend() had already succeeded you MUST call releaseSend() before returning. A row stuck `working` after this call is
   * marked failed ("Interrupted during send"), never requeued.
   */
  markSendStarted(emailLogId?: string): Promise<void>;
  /** Reserve one send slot against daily_send_cap BEFORE sending. Resolves false when the run is not active or the cap is reached: do not send. */
  reserveSend(): Promise<boolean>;
  /** Give the reserved slot back if the send fails. The engine never increments outreach_sent_total itself. */
  releaseSend(): Promise<void>;
}

export type PipelineOutcome =
  | { outcome: 'sent'; emailLogId: string; sequenceId: string; costCents: number }
  | { outcome: 'skipped' | 'needs_input' | 'failed'; reason: string; emailLogId?: string; sequenceId?: string; costCents?: number };

const timeUp = (ctx: PipelineContext): boolean => !canSendNow({ deadlineMs: ctx.deadlineMs, nowMs: Date.now(), sendStarted: false });

/** Saves a finished draft and parks the lead so a person can review it. The draft id is kept even if saving fails (undefined). */
async function park(ctx: PipelineContext, lead: Lead, recipient: Recipient, draft: Draft, reason: string, progress: Progress): Promise<PipelineOutcome> {
  const emailLogId = (await insertDraftLog(ctx, lead, recipient, draft)) ?? undefined;
  return { outcome: 'needs_input', reason, emailLogId, sequenceId: progress.sequenceId, costCents: progress.costCents };
}

/** Why this draft must not be sent, in plain English, or null when it is clean. */
function draftProblem(draft: Draft): string | null {
  const names = unfilledPlaceholderNames(draft.subject, draft.body, draft.missing);
  if (names.length > 0) return placeholderReason(names);
  if (hasStrayPlaceholder(`${draft.subject} ${draft.body}`)) return 'The draft contains a placeholder that was not filled in';
  if (draft.unexpected.length > 0) return 'Draft contains a link or address that was not in the template';
  if (!draft.unsubscribeOk) return 'The unsubscribe link is not set up for this app, so the draft was saved for review';
  if (draft.aiFailed) return 'The AI draft failed, so a plain draft was saved for you to review';
  if (!draft.subject.trim() || !draft.body.trim()) return 'The draft was empty, so it was saved for you to review';
  return null;
}

async function run(ctx: PipelineContext, progress: Progress): Promise<PipelineOutcome> {
  const { service } = ctx;
  const stopped = (reason: string, outcome: 'skipped' | 'needs_input' = 'needs_input'): PipelineOutcome => ({ outcome, reason, sequenceId: progress.sequenceId, costCents: progress.costCents });

  // 1 and 2. Load the org, the sender and the keys; confirm the person who started the run may send for this lead.
  const org = await loadOrgContext(service, ctx.run);
  if (!(await creatorCanSend(service, ctx.run, ctx.lead))) return stopped('The person who started this run cannot access this lead', 'skipped');
  if (!org.keys.anthropic) return stopped('No AI key is set up for this organization');
  if (!org.senderName) return stopped('The person who started this run has no name on their profile');

  // 3. A usable recipient (looks up details and decision-makers only when needed).
  const got = await ensureRecipient(ctx, org.keys);
  if (isStop(got)) return got.stop;
  const { lead, candidates, recipient } = got;
  const candidate = candidates.find((c) => c.id === recipient.candidateId) ?? null;
  if (timeUp(ctx)) return stopped(TIMEOUT_REASON);

  // 4. Research (best effort). Only real content is saved as a note.
  const noteTexts = await loadNotes(service, lead.id);
  const research = await raceDeadline(researchLead({ service, lead, notes: noteTexts, orgId: ctx.run.org_id, geminiKey: org.keys.gemini }), ctx.deadlineMs)
    .catch(() => ({ summary: '', sources: [] as string[], costCents: org.keys.gemini ? RESEARCH_COST_CENTS : 0 }));
  progress.costCents += research.costCents;
  if (!isEmptyResearch(research)) {
    noteTexts.unshift(research.summary);
    const { error } = await service.from('lead_notes').insert({ lead_id: lead.id, created_by: ctx.run.created_by, note_type: 'ai_summary', content: research.summary });
    if (error) console.error('autopilot: could not save the research note');
  }
  if (timeUp(ctx)) return stopped(TIMEOUT_REASON);

  // 5. Sequence and step.
  const { sequences, templates } = await loadSequencesAndTemplates(service, ctx.run.org_id);
  const chosen = await chooseSequence(ctx, lead, sequences, research.summary, org.keys.anthropic, progress);
  if (isStop(chosen)) return { ...chosen.stop, costCents: progress.costCents };
  if (timeUp(ctx)) return stopped(TIMEOUT_REASON);

  // 6. Draft.
  const draft = await buildDraft(ctx, {
    lead, sequence: chosen.sequence, step: chosen.step, templates, candidate, noteTexts, senderName: org.senderName,
    orgName: org.orgName, companyContext: org.companyContext, anthropicKey: org.keys.anthropic,
  }, progress);
  if (isStop(draft)) return { ...draft.stop, costCents: progress.costCents };

  // 7. Placeholder safety (also: AI failed, empty draft). Never send these.
  const problem = draftProblem(draft);
  if (problem) return park(ctx, lead, recipient, draft, problem, progress);
  if (timeUp(ctx)) return park(ctx, lead, recipient, draft, TIMEOUT_REASON, progress);

  // 8. Send safeguards, in order: last check, reserve a slot, save the draft, mark the send, send.
  const last = await lastMinuteCheck(ctx, recipient);
  if ('skip' in last) return stopped(last.skip, 'skipped');
  if (!(await ctx.reserveSend())) return stopped('Daily send cap reached or the run was stopped', 'skipped');
  progress.reserved = true;
  const emailLogId = await insertDraftLog(ctx, lead, recipient, draft);
  if (!emailLogId) {
    await ctx.releaseSend();
    return { outcome: 'failed', reason: 'Could not save the draft; did not send', sequenceId: chosen.sequence.id, costCents: progress.costCents };
  }
  progress.emailLogId = emailLogId;
  return sendDraft(ctx, lead, last.stage, recipient, draft, emailLogId, chosen.sequence, chosen.step, progress);
}

/**
 * Runs the whole per-lead pipeline. Never throws. Before markSendStarted an unexpected error returns `failed` (and gives
 * back a reserved slot). After markSendStarted an error means the email may have gone out: `failed` with a plain note,
 * never retried and the slot is never released.
 */
export async function processLeadPipeline(ctx: PipelineContext): Promise<PipelineOutcome> {
  const progress: Progress = { costCents: 0, reserved: false, sendStarted: false };
  try {
    return await run(ctx, progress);
  } catch (e) {
    const common = { emailLogId: progress.emailLogId, sequenceId: progress.sequenceId, costCents: progress.costCents };
    if (progress.sendStarted) {
      await markLogInterrupted(ctx.service, progress.emailLogId);
      return { outcome: 'failed', reason: 'Error after send started; check Email logs', ...common };
    }
    if (progress.reserved) { try { await ctx.releaseSend(); } catch { console.error('autopilot: could not release the send slot'); } }
    return { outcome: 'failed', reason: plainReason(e instanceof Error ? e.message : ''), ...common };
  }
}
