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
}

export type PipelineOutcome =
  | { outcome: 'sent'; emailLogId: string; sequenceId: string; costCents: number }
  | { outcome: 'skipped' | 'needs_input' | 'failed'; reason: string; emailLogId?: string; sequenceId?: string; costCents?: number };

/** Runs the heavy per-lead pipeline. Stub until Task 12b. */
export function processLeadPipeline(_ctx: PipelineContext): Promise<PipelineOutcome> {
  return Promise.resolve({ outcome: 'needs_input', reason: 'Pipeline not implemented yet' });
}
