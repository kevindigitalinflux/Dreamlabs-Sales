import {
  buildDefaultTemplateIdByType, decidePostSend, describePostSend,
  type EnrollmentLike, type SequenceLike, type VisibleTemplate,
} from '../../supabase/functions/_shared/postSendRules';

/** Everything the preview needs, already loaded by the hooks. */
export interface PreviewInput {
  orgId: string;
  templateId: string;
  templates: VisibleTemplate[];
  sequences: SequenceLike[];
  enrollment: EnrollmentLike | null;
  currentNextActionDate: string | null;
  /** Today as YYYY-MM-DD (local). */
  todayLocal: string;
  now: Date;
  subject: string;
  recipientLabel: string;
}

/** Lines for "What happens after sending", or null when no honest preview can be made (no template chosen or not visible). */
export function buildPostSendPreview(input: PreviewInput): string[] | null {
  const tpl = input.templates.find((t) => t.id === input.templateId);
  if (!input.templateId || !tpl) return null;
  const decision = decidePostSend({
    templateId: tpl.id,
    template: { id: tpl.id, template_type: tpl.template_type, is_default: tpl.is_default },
    enrollment: input.enrollment,
    sequences: input.sequences,
    defaultTemplateIdByType: buildDefaultTemplateIdByType(input.templates, input.orgId),
    logLinkedToEnrollment: false,
    currentNextActionDate: input.currentNextActionDate,
    todayLocal: input.todayLocal,
    now: input.now,
    subject: input.subject,
    recipientLabel: input.recipientLabel,
  });
  return describePostSend(decision);
}

/** What the send-email response says happened after sending. */
export interface PostSendReport { lines: string[]; warnings: string[] }

/** Reads `post_send` from a send-email response; tolerant of its absence (older function) or odd shapes. */
export function parsePostSend(data: unknown): PostSendReport | null {
  if (!data || typeof data !== 'object') return null;
  const p = (data as { post_send?: unknown }).post_send;
  if (!p || typeof p !== 'object') return null;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const lines = strings((p as { lines?: unknown }).lines);
  const warnings = strings((p as { warnings?: unknown }).warnings);
  return lines.length || warnings.length ? { lines, warnings } : null;
}

/** Merges reports from several sends (several recipients), dropping repeated lines. */
export function mergePostSend(reports: (PostSendReport | null)[]): PostSendReport | null {
  const lines = new Set<string>();
  const warnings = new Set<string>();
  for (const r of reports) { r?.lines.forEach((l) => lines.add(l)); r?.warnings.forEach((w) => warnings.add(w)); }
  return lines.size || warnings.size ? { lines: [...lines], warnings: [...warnings] } : null;
}
