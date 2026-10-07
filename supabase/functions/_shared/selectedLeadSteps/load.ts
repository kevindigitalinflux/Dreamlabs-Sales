// Step 1 and 2: load what the pipeline needs, and confirm the run's creator may send for this lead.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { resolveOrgApiKey } from '../orgApiKeys.ts';
import { canCreatorViewLead, senderFirstName } from '../selectedLeadPipelineRules.ts';
import type { PipelineRun } from '../selectedLeadPipeline.ts';
import type { CandidateRow, Lead, OrgKeys, SequenceRow, TemplateRow } from './types.ts';

export interface OrgContext { orgName: string; companyContext: string | null; senderName: string | null; keys: OrgKeys }

/** Org name and context, the creator's first name (null when the profile has no name), and the org's API keys. */
export async function loadOrgContext(service: SupabaseClient, run: PipelineRun): Promise<OrgContext> {
  const [{ data: org }, { data: profile }, anthropic, gemini, hunter, apollo, companiesHouse, openCorporates, googlePlaces] = await Promise.all([
    service.from('organizations').select('name, company_context').eq('id', run.org_id).maybeSingle(),
    service.from('profiles').select('full_name').eq('id', run.created_by).maybeSingle(),
    resolveOrgApiKey(service, run.org_id, 'anthropic'), resolveOrgApiKey(service, run.org_id, 'gemini'),
    resolveOrgApiKey(service, run.org_id, 'hunter'), resolveOrgApiKey(service, run.org_id, 'apollo'),
    resolveOrgApiKey(service, run.org_id, 'companies_house'), resolveOrgApiKey(service, run.org_id, 'opencorporates'),
    resolveOrgApiKey(service, run.org_id, 'google_places'),
  ]);
  return {
    orgName: (org as { name?: string } | null)?.name ?? 'our team',
    companyContext: (org as { company_context?: string | null } | null)?.company_context ?? null,
    senderName: senderFirstName((profile as { full_name?: string | null } | null)?.full_name),
    keys: { anthropic, gemini, hunter, apollo, companiesHouse, openCorporates, googlePlaces },
  };
}

/** Non-dismissed decision-maker candidates for a lead, oldest first. */
export async function loadCandidates(service: SupabaseClient, leadId: string): Promise<CandidateRow[]> {
  const { data } = await service.from('decision_maker_candidates').select('*').eq('lead_id', leadId).is('dismissed_at', null).order('created_at');
  return (data ?? []) as CandidateRow[];
}

/** The org's sequences plus the shared (org-less) defaults, and the templates visible to the org. Same visibility rule for both. */
export async function loadSequencesAndTemplates(service: SupabaseClient, orgId: string): Promise<{ sequences: SequenceRow[]; templates: TemplateRow[] }> {
  const scope = `org_id.eq.${orgId},org_id.is.null`;
  const [{ data: seqs }, { data: tpls }] = await Promise.all([
    service.from('email_sequences').select('*').or(scope),
    service.from('email_templates').select('*').or(scope),
  ]);
  const sequences = ((seqs ?? []) as SequenceRow[]).map((s) => ({ ...s, steps: Array.isArray(s.steps) ? s.steps : [] }));
  return { sequences, templates: (tpls ?? []) as TemplateRow[] };
}

/** Newest 5 note contents for a lead. */
export async function loadNotes(service: SupabaseClient, leadId: string): Promise<string[]> {
  const { data } = await service.from('lead_notes').select('content').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(5);
  return (data ?? []).map((n) => (n as { content: string }).content);
}

/**
 * Whether the run's creator may send for this lead: the id-based equivalent of the can_view_lead SQL function
 * (see canCreatorViewLead). A lookup error throws (the lead then fails safely) rather than guessing.
 */
export async function creatorCanSend(service: SupabaseClient, run: PipelineRun, lead: Lead): Promise<boolean> {
  const { data: member, error: mErr } = await service.from('org_members').select('role').eq('org_id', run.org_id).eq('user_id', run.created_by).maybeSingle();
  if (mErr) throw new Error('Could not check access for the person who started this run');
  const pipelineId = lead.pipeline_id as string | null | undefined;
  if (!pipelineId) return false;
  const { data: pipeline, error: pErr } = await service.from('pipelines').select('org_id, is_default, created_by').eq('id', pipelineId).maybeSingle();
  if (pErr) throw new Error('Could not check access for the person who started this run');
  const p = pipeline as { org_id: string; is_default: boolean; created_by: string | null } | null;
  if (!p || p.org_id !== run.org_id) return false;
  const { count } = await service.from('pipeline_shares').select('id', { count: 'exact', head: true }).eq('pipeline_id', pipelineId).eq('shared_with_user_id', run.created_by);
  return canCreatorViewLead({
    memberRole: (member as { role: string } | null)?.role ?? null,
    pipeline: { is_default: p.is_default, created_by: p.created_by },
    leadCreatedBy: (lead.created_by as string | null | undefined) ?? null,
    leadAssignedTo: (lead.assigned_to as string | null | undefined) ?? null,
    shared: (count ?? 0) > 0, creatorId: run.created_by,
  });
}
