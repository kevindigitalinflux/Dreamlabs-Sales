// Step 6: draft the email the way check-sequences does (template, variables, notes-then-draft, links, attachments),
// plus the unattended safeguards: nothing is invented, the greeting matches the recipient, and every email can be opted out of.
import { draftEmailClaude } from '../ai.ts';
import { appendLinks, onlyOrgAttachments, parseAttachments, parseLinks, type EmailAttachment } from '../emailAttachments.ts';
import { applyCustomVariables, loadCustomVariables } from '../customVariables.ts';
import { formatIcpContext, loadIcp, resolveIcpId, topPainPoint } from '../icp.ts';
import { buildTemplateVars, substituteVariables } from '../templateVars.ts';
import { stripAiPunctuation } from '../textGuardrails.ts';
import {
  DRAFT_COST_CENTS, chooseTemplate, isUsableUnsubscribeUrl, recipientLabel, recipientVarOverrides, unexpectedLinksOrAddresses, withUnsubscribeLine,
} from '../selectedLeadPipelineRules.ts';
import type { PipelineContext } from '../selectedLeadPipeline.ts';
import { raceDeadline, type CandidateRow, type Lead, type Progress, type SequenceRow, type Stop, type TemplateRow } from './types.ts';

export interface Draft {
  subject: string; body: string; attachments: EmailAttachment[];
  /** Variables the template could not fill (blanked by substituteVariables); the draft must not be sent. */
  missing: string[];
  /** True when the AI draft failed and the plain filled template is shown instead; the draft must not be sent. */
  aiFailed: boolean;
  /** Links or addresses the AI added that were not in the template; the draft must not be sent. */
  unexpected: string[];
  /** False when the unsubscribe link is not a usable https link; the draft must not be sent. */
  unsubscribeOk: boolean;
}

export interface DraftInput {
  lead: Lead; sequence: SequenceRow; step: number; templates: TemplateRow[];
  candidate: CandidateRow | null; noteTexts: string[]; senderName: string;
  orgName: string; companyContext: string | null; anthropicKey: string;
}

/** Builds the draft for one step. Unresolvable template => a needs_input stop. Costs one draft's worth of AI cents only if the AI is called. */
export async function buildDraft(ctx: PipelineContext, i: DraftInput, progress: Progress): Promise<Draft | Stop> {
  const orgId = ctx.run.org_id;
  const stepDef = i.sequence.steps[i.step - 1]!;
  const template = chooseTemplate(i.templates, stepDef, orgId);
  if (!template) return { stop: { outcome: 'needs_input', reason: `Template for step ${i.step} could not be found`, sequenceId: i.sequence.id } };

  // With a chosen decision maker the data given to the template and the AI is about THAT person, never the lead's owner.
  const overrides = recipientVarOverrides(i.candidate);
  const lead: Lead = i.candidate ? { ...i.lead, owner_name: overrides.owner_name || null } : i.lead;
  const icp = await loadIcp(ctx.service, orgId, resolveIcpId(i.lead.icp_id as string | null, template.icp_id, i.sequence.icp_id));
  const icpContext = formatIcpContext(icp);
  const builtIn = { ...buildTemplateVars(lead, i.senderName, i.noteTexts, topPainPoint(icp)), ...overrides };
  const vars = applyCustomVariables(builtIn, await loadCustomVariables(ctx.service, orgId, ctx.run.created_by));
  const subject = substituteVariables((stepDef.subject_override ?? template.subject) as string, vars);
  const body = substituteVariables(template.body, vars);
  const missing = [...new Set([...subject.missing, ...body.missing])];
  const attachments = onlyOrgAttachments(parseAttachments(template.attachments), orgId);
  const links = parseLinks(template.links);
  const unsubscribeUrl = String(vars.unsubscribe_url ?? '');
  const unsubscribeOk = isUsableUnsubscribeUrl(unsubscribeUrl);
  const finish = (s: string, b: string) => ({ subject: s, body: withUnsubscribeLine(appendLinks(b, links), unsubscribeUrl) });

  // Anything the template could not fill parks the lead, so do not spend on the AI.
  if (missing.length > 0) return { ...finish(subject.text, body.text), attachments, missing, aiFailed: false, unexpected: [], unsubscribeOk };

  try {
    progress.costCents += DRAFT_COST_CENTS;
    const ai = await raceDeadline(draftEmailClaude({
      subject: subject.text, body: body.text, lead, notes: i.noteTexts, contractorName: i.senderName,
      orgName: i.orgName, companyContext: i.companyContext, icpContext, apiKey: i.anthropicKey, model: 'claude-haiku-4-5',
      recipient: recipientLabel(i.candidate, lead.owner_name as string | null), untrustedData: true,
    }), ctx.deadlineMs);
    const aiSubject = stripAiPunctuation(ai.subject);
    const aiBody = stripAiPunctuation(ai.body);
    const unexpected = unexpectedLinksOrAddresses(`${subject.text} ${body.text}`, `${aiSubject} ${aiBody}`, [unsubscribeUrl, ...links.map((l) => l.url), ...attachments.map((a) => a.name)], (i.lead.website as string | null) ?? null);
    return { ...finish(aiSubject, aiBody), attachments, missing, aiFailed: false, unexpected, unsubscribeOk };
  } catch {
    console.error('autopilot: AI draft failed, keeping the plain template for review');
    return { ...finish(subject.text, body.text), attachments, missing, aiFailed: true, unexpected: [], unsubscribeOk };
  }
}
