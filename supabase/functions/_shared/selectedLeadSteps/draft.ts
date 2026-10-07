// Step 6: draft the email exactly the way check-sequences does (template, variables, notes-then-draft, links, attachments).
import { draftEmailClaude } from '../ai.ts';
import { appendLinks, onlyOrgAttachments, parseAttachments, parseLinks, type EmailAttachment } from '../emailAttachments.ts';
import { applyCustomVariables, loadCustomVariables } from '../customVariables.ts';
import { formatIcpContext, loadIcp, resolveIcpId, topPainPoint } from '../icp.ts';
import { buildTemplateVars, substituteVariables } from '../templateVars.ts';
import { stripAiPunctuation } from '../textGuardrails.ts';
import { DRAFT_COST_CENTS, chooseTemplate, recipientVarOverrides } from '../selectedLeadPipelineRules.ts';
import type { PipelineContext } from '../selectedLeadPipeline.ts';
import { raceDeadline, type CandidateRow, type Lead, type Progress, type SequenceRow, type Stop, type TemplateRow } from './types.ts';

export interface Draft {
  subject: string; body: string; attachments: EmailAttachment[];
  /** Variables the template could not fill (blanked by substituteVariables); the draft must not be sent. */
  missing: string[];
  /** True when the AI draft failed and the plain filled template is shown instead; the draft must not be sent. */
  aiFailed: boolean;
}

export interface DraftInput {
  lead: Lead; sequence: SequenceRow; step: number; templates: TemplateRow[];
  candidate: CandidateRow | null; noteTexts: string[]; senderName: string;
  orgName: string; companyContext: string | null; anthropicKey: string;
}

/** Builds the draft for one step. Unresolvable template => a needs_input stop. Costs one draft's worth of AI cents. */
export async function buildDraft(ctx: PipelineContext, i: DraftInput, progress: Progress): Promise<Draft | Stop> {
  const orgId = ctx.run.org_id;
  const stepDef = i.sequence.steps[i.step - 1]!;
  const template = chooseTemplate(i.templates, stepDef, orgId);
  if (!template) return { stop: { outcome: 'needs_input', reason: `Template for step ${i.step} could not be found`, sequenceId: i.sequence.id } };

  const icp = await loadIcp(ctx.service, orgId, resolveIcpId(i.lead.icp_id as string | null, template.icp_id, i.sequence.icp_id));
  const icpContext = formatIcpContext(icp);
  const builtIn = { ...buildTemplateVars(i.lead, i.senderName, i.noteTexts, topPainPoint(icp)), ...recipientVarOverrides(i.candidate) };
  const vars = applyCustomVariables(builtIn, await loadCustomVariables(ctx.service, orgId, ctx.run.created_by));
  const subject = substituteVariables((stepDef.subject_override ?? template.subject) as string, vars);
  const body = substituteVariables(template.body, vars);
  const missing = [...new Set([...subject.missing, ...body.missing])];
  const attachments = onlyOrgAttachments(parseAttachments(template.attachments), orgId);
  const links = parseLinks(template.links);

  try {
    progress.costCents += DRAFT_COST_CENTS;
    const ai = await raceDeadline(draftEmailClaude({
      subject: subject.text, body: body.text, lead: i.lead, notes: i.noteTexts, contractorName: i.senderName,
      orgName: i.orgName, companyContext: i.companyContext, icpContext, apiKey: i.anthropicKey, model: 'claude-haiku-4-5',
    }), ctx.deadlineMs);
    return { subject: stripAiPunctuation(ai.subject), body: appendLinks(stripAiPunctuation(ai.body), links), attachments, missing, aiFailed: false };
  } catch {
    console.error('autopilot: AI draft failed, keeping the plain template for review');
    return { subject: subject.text, body: appendLinks(body.text, links), attachments, missing, aiFailed: true };
  }
}
