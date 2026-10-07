// STUB: Task 12b replaces this file with the real per-lead pipeline
// (enrich / decision-maker search, research, sequence pick, draft, placeholder park, send, platform updates).
// The engine (selectedAutopilot.ts) depends only on the types and function signature below.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { EligibilityEnrollment } from './autopilotEligibility.ts';

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
   * Rejects if the marker could not be saved: do NOT send in that case. A row stuck `working` after this call is
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

/** Runs the heavy per-lead pipeline. Stub until Task 12b. */
export function processLeadPipeline(_ctx: PipelineContext): Promise<PipelineOutcome> {
  return Promise.resolve({ outcome: 'needs_input', reason: 'Pipeline not implemented yet' });
}
