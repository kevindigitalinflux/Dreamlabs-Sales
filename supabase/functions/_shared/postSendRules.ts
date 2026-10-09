// Pure post-send decision table: what should change on the platform after a manual email is sent.
// No imports, so it runs in both Deno (edge functions) and Vitest (src/lib tests).
// The advance arithmetic below mirrors `nextEnrollmentState` in selectedLeadPipelineRules.ts (itself the copy of
// check-sequences' `advance`); keep the three in step if the rule ever changes.

const DAY_MS = 86_400_000;

/** A sequence as the post-send rules need it. */
export interface SequenceLike {
  id: string;
  name: string;
  steps: { delay_days: number; template_type: string; template_id?: string | null }[];
}

/** The template that was sent. */
export interface TemplateRef { id: string; template_type: string; is_default: boolean }

/** A lead's enrolment in a sequence. `current_step` is the 1-based step due next. */
export interface EnrollmentLike {
  id: string;
  sequence_id: string;
  current_step: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  next_send_at: string | null;
}

/** Input to {@link decidePostSend}. */
export interface PostSendInput {
  templateId: string | null;
  template: TemplateRef | null;
  enrollment: EnrollmentLike | null;
  sequences: SequenceLike[];
  defaultTemplateIdByType: Record<string, string>;
  /** True when the sequence engine already advanced the enrolment at draft time (log has sequence_enrollment_id). */
  logLinkedToEnrollment: boolean;
  currentNextActionDate: string | null;
  /** Today as YYYY-MM-DD in the user's timezone. */
  todayLocal: string;
  now: Date;
  subject: string;
  recipientLabel: string;
  /** Days until the generic follow up. Default 3. */
  defaultFollowUpDays?: number;
  /** Converts an ISO instant to a local YYYY-MM-DD. Default: the first 10 characters (UTC date). */
  toLocalDate?: (iso: string) => string;
}

/** What to do after the send. */
export interface PostSendDecision {
  note: string;
  action: 'none' | 'advance' | 'enrol' | 'link_only';
  enrollmentId?: string;
  sequenceId?: string;
  sequenceName?: string;
  /** Number of steps in the sequence involved, for display. */
  totalSteps?: number;
  newCurrentStep?: number;
  nextSendAt?: string | null;
  newStatus?: 'active' | 'completed';
  /** For the conditional update: the step that was current before advancing. */
  expectedCurrentStep?: number;
  nextAction: { set: boolean; date: string | null; note: string | null };
  /** Plain English explanation for the "What happens after sending" line. */
  reason: string;
}

/** Template visible to an org: its own (org_id = org) or shared (org_id = null). */
export interface VisibleTemplate { id: string; org_id: string | null; template_type: string; is_default: boolean }

/**
 * Map of template type to the id of the default template for that type, as check-sequences resolves it:
 * only templates visible to `orgId` count, and the org's own default beats the shared (org-less) default.
 */
export function buildDefaultTemplateIdByType(templates: VisibleTemplate[], orgId: string): Record<string, string> {
  const out: Record<string, string> = {};
  const fromGlobal: Record<string, string> = {};
  for (const t of templates) {
    if (!t.is_default) continue;
    if (t.org_id === orgId) out[t.template_type] = t.id;
    else if (t.org_id === null && !(t.template_type in fromGlobal)) fromGlobal[t.template_type] = t.id;
  }
  for (const [type, id] of Object.entries(fromGlobal)) if (!(type in out)) out[type] = id;
  return out;
}

/**
 * True when a sequence step sends this template: the step names the template id, or the step names no id and its
 * template type resolves (via `defaultTemplateIdByType`) to this template as the default for the type.
 */
export function stepUsesTemplate(
  step: { template_type: string; template_id?: string | null },
  template: TemplateRef,
  defaultTemplateIdByType: Record<string, string>,
): boolean {
  if (step.template_id) return step.template_id === template.id;
  return defaultTemplateIdByType[step.template_type] === template.id;
}

/** Pure calendar arithmetic on a YYYY-MM-DD string (no timezone drift). */
function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Subject for display in notes: dashes removed (house style), cut to 120 characters. */
function cleanSubject(subject: string): string {
  return subject.replace(/\s*[—–]\s*/g, ', ').trim().slice(0, 120);
}

/**
 * Decides the platform updates after a successful manual send. See the spec, Piece C. The sequence engine
 * having already advanced the enrolment wins; an unrelated template never moves an enrolment; a paused
 * enrolment is never replaced; a manually chosen future next-action date is never overwritten.
 */
export function decidePostSend(input: PostSendInput): PostSendDecision {
  const subject = cleanSubject(input.subject);
  const note = `Email sent: ${subject} (to ${input.recipientLabel})`;
  const toLocal = input.toLocalDate ?? ((iso: string) => iso.slice(0, 10));
  const followDays = input.defaultFollowUpDays ?? 3;
  const { template, enrollment, sequences } = input;

  const finish = (
    part: Omit<PostSendDecision, 'note' | 'nextAction'>,
    followUp: { nextSendAt: string; sequenceName: string; step: number; total: number } | null,
  ): PostSendDecision => {
    const cur = input.currentNextActionDate?.trim().slice(0, 10) ?? '';
    const canSet = cur === '' || cur <= input.todayLocal;
    const nextAction = !canSet
      ? { set: false, date: null, note: null }
      : followUp
        ? { set: true, date: toLocal(followUp.nextSendAt), note: `Follow up: ${followUp.sequenceName} step ${followUp.step} of ${followUp.total}` }
        : { set: true, date: addDaysYmd(input.todayLocal, followDays), note: `Follow up after email: ${subject}` };
    return { note, ...part, nextAction };
  };
  const none = (reason: string) => finish({ action: 'none', reason }, null);

  // 2. The sequence engine already advanced at draft time: keep the date consistent with that enrolment.
  if (input.logLinkedToEnrollment) {
    const seq = enrollment ? sequences.find((s) => s.id === enrollment.sequence_id) : undefined;
    const due = enrollment && enrollment.status === 'active' && enrollment.next_send_at && seq
      ? { nextSendAt: enrollment.next_send_at, sequenceName: seq.name, step: enrollment.current_step, total: seq.steps.length }
      : null;
    return finish({ action: 'link_only', enrollmentId: enrollment?.id, sequenceId: seq?.id, sequenceName: seq?.name, reason: 'The sequence was already moved on when this draft was made, so it is not moved again' }, due);
  }

  // 3 and 4. An active enrolment: advance only when the sent template is its current step's template.
  if (enrollment && enrollment.status === 'active') {
    const seq = sequences.find((s) => s.id === enrollment.sequence_id);
    const step = seq?.steps[enrollment.current_step - 1];
    if (!seq || !step || !template || !stepUsesTemplate(step, template, input.defaultTemplateIdByType)) {
      return none('This is not the template for the lead\'s current sequence step, so the sequence stays where it is');
    }
    // Same arithmetic as nextEnrollmentState: `current_step` is the step that was just sent.
    const next = enrollment.current_step + 1;
    const total = seq.steps.length;
    const common = { action: 'advance' as const, enrollmentId: enrollment.id, sequenceId: seq.id, sequenceName: seq.name, totalSteps: total, expectedCurrentStep: enrollment.current_step };
    if (next > total) {
      return finish({ ...common, newCurrentStep: enrollment.current_step, nextSendAt: null, newStatus: 'completed', reason: `This was the last step, so the ${seq.name} sequence is completed` }, null);
    }
    const nextSendAt = new Date(input.now.getTime() + seq.steps[next - 1]!.delay_days * DAY_MS).toISOString();
    return finish({ ...common, newCurrentStep: next, nextSendAt, newStatus: 'active', reason: `Moves the lead on to step ${next} of ${total} in ${seq.name}` }, { nextSendAt, sequenceName: seq.name, step: next, total });
  }

  // 5. Never enrol over a paused enrolment. Completed or cancelled ones can be re-enrolled.
  if (enrollment && enrollment.status === 'paused') return none('The lead\'s sequence is paused, so it is left alone');
  if (!template) return none('No template is recorded for this email, so no sequence change');

  const matches = sequences
    .map((s) => ({ s, idx: s.steps.map((st, i) => (stepUsesTemplate(st, template, input.defaultTemplateIdByType) ? i : -1)).filter((i) => i >= 0) }))
    .filter((m) => m.idx.length > 0);
  if (matches.length === 0) return none('No sequence uses this template, so no sequence change');
  if (matches.length > 1) return none('This template is used by more than one sequence, so the lead is not enrolled automatically');
  const { s: seq, idx } = matches[0]!;
  if (idx.length > 1) return none(`This template appears at more than one step of ${seq.name}, so the lead is not enrolled automatically`);
  const newCurrentStep = idx[0]! + 2;
  if (newCurrentStep > seq.steps.length) return none(`This is the last step of sequence ${seq.name}, so there is nothing further to enrol into`);
  const nextSendAt = new Date(input.now.getTime() + seq.steps[newCurrentStep - 1]!.delay_days * DAY_MS).toISOString();
  return finish(
    { action: 'enrol', sequenceId: seq.id, sequenceName: seq.name, totalSteps: seq.steps.length, newCurrentStep, nextSendAt, newStatus: 'active', reason: `Enrols the lead in ${seq.name} at step ${newCurrentStep}` },
    { nextSendAt, sequenceName: seq.name, step: newCurrentStep, total: seq.steps.length },
  );
}

/** Short lines for the "What happens after sending" preview. */
export function describePostSend(d: PostSendDecision): string[] {
  const lines: string[] = [];
  if (d.action === 'advance') {
    lines.push(d.newStatus === 'completed' ? `Completes the ${d.sequenceName} sequence` : `Moves the lead to step ${d.newCurrentStep} of ${d.sequenceName}`);
  } else if (d.action === 'enrol') {
    lines.push(`Enrols the lead in ${d.sequenceName} at step ${d.newCurrentStep} of ${d.totalSteps}`);
  } else if (d.action === 'link_only') {
    lines.push('Sequence already updated when this draft was made');
  } else {
    lines.push('No sequence change');
  }
  lines.push(d.nextAction.set ? `Follow-up set for ${d.nextAction.date}` : 'Your existing next action date is kept');
  return lines;
}
