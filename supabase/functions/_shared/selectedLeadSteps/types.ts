// Shared types and tiny helpers for the selected-leads autopilot pipeline steps.
import type { PipelineContext, PipelineOutcome } from '../selectedLeadPipeline.ts';

/** A step that decided the lead must stop here (skipped, parked or failed). */
export interface Stop { stop: PipelineOutcome }

export type Lead = PipelineContext['lead'];

export interface OrgKeys {
  anthropic: string | null; gemini: string | null; hunter: string | null; apollo: string | null;
  companiesHouse: string | null; openCorporates: string | null; googlePlaces: string | null;
}

export interface SequenceRow {
  id: string; name: string; description: string | null; category: string | null; icp_id: string | null;
  steps: { delay_days: number; template_type: string; template_id?: string | null; subject_override: string | null }[];
}

export interface CandidateRow {
  id: string; title: string | null; email: string | null; first_name: string | null; last_name: string | null;
  name_obfuscated: boolean; dismissed_at: string | null;
}

export interface TemplateRow {
  id: string; org_id: string | null; template_type: string; is_default: boolean; subject: string; body: string;
  icp_id?: string | null; attachments?: unknown; links?: unknown;
}

/** Mutable progress shared across steps so the wrapper can report cost and send state on any exit. */
export interface Progress { costCents: number; reserved: boolean; sendStarted: boolean; emailLogId?: string; sequenceId?: string }

export const isStop = (v: unknown): v is Stop => typeof v === 'object' && v !== null && 'stop' in v;

/** Rejects when the soft deadline passes first (the underlying work keeps running, its result is ignored). Never use after SMTP started. */
export function raceDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T> {
  const left = Math.max(0, deadlineMs - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Soft deadline reached')), left); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export const TIMEOUT_REASON = 'Ran out of time before this lead could be finished';
