// Step 5: choose the sequence and the step due now.
import { chooseSequenceClaude } from '../ai.ts';
import { pickSequence } from '../autopilotChoices.ts';
import { PICK_COST_CENTS } from '../selectedLeadPipelineRules.ts';
import type { PipelineContext } from '../selectedLeadPipeline.ts';
import { raceDeadline, type Lead, type Progress, type SequenceRow, type Stop } from './types.ts';

export interface SequenceChoice { sequence: SequenceRow; step: number }

/**
 * An existing enrolment decides its own sequence and step. Otherwise one cheap Haiku call suggests a sequence
 * (validated against the real list by pickSequence, with the ICP match as the fallback) and the step is 1.
 */
export async function chooseSequence(
  ctx: PipelineContext, lead: Lead, sequences: SequenceRow[], researchSummary: string, anthropicKey: string, progress: Progress,
): Promise<SequenceChoice | Stop> {
  const usable = sequences.filter((s) => s.steps.length > 0);
  const enrolled = ctx.enrollment?.sequence_id ?? null;

  let aiPickedId: string | null = null;
  if (!ctx.enrollment && usable.length > 0) {
    try {
      progress.costCents += PICK_COST_CENTS;
      aiPickedId = await raceDeadline(chooseSequenceClaude({
        sequences: usable.map((s) => ({ id: s.id, name: s.name, description: s.description, category: s.category })),
        lead, researchSummary, apiKey: anthropicKey,
      }), ctx.deadlineMs);
    } catch { console.error('autopilot: sequence pick failed, using profile match'); }
  }

  const id = pickSequence({
    enrolledSequenceId: enrolled, aiPickedId, icpId: (lead.icp_id as string | null) ?? null,
    sequences: usable.map((s) => ({ id: s.id, icp_id: s.icp_id })),
  });
  if (ctx.enrollment && !enrolled) return { stop: { outcome: 'needs_input', reason: 'Could not find the sequence this lead is in' } };
  if (!id) return { stop: { outcome: 'needs_input', reason: 'No suitable sequence for this lead' } };
  const sequence = sequences.find((s) => s.id === id);
  if (!sequence) return { stop: { outcome: 'needs_input', reason: 'Could not find the sequence this lead is in' } };
  progress.sequenceId = sequence.id;
  if (sequence.steps.length === 0) return { stop: { outcome: 'needs_input', reason: 'The chosen sequence has no steps', sequenceId: sequence.id } };

  const step = ctx.enrollment ? Math.max(1, Math.floor(Number(ctx.enrollment.current_step ?? 1)) || 1) : 1;
  if (step > sequence.steps.length) return { stop: { outcome: 'skipped', reason: 'Sequence already finished for this lead', sequenceId: sequence.id } };
  return { sequence, step };
}
