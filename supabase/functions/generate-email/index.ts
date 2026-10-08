import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { draftEmail } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { buildTemplateVars, substituteVariables } from '../_shared/templateVars.ts';
import { appendLinks, onlyOrgAttachments, parseAttachments, parseLinks } from '../_shared/emailAttachments.ts';
import { formatIcpContext, loadIcp, resolveIcpId, topPainPoint } from '../_shared/icp.ts';
import { applyCustomVariables, loadCustomVariables } from '../_shared/customVariables.ts';

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await client.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = (await req.json()) as { lead_id?: string; template_id?: string; use_ai?: boolean; recipient_name?: string; recipient_title?: string; recipient_kind?: string };
  if (!body.lead_id || !body.template_id) return json({ error: 'lead_id and template_id required' }, 400, headers);

  // RLS applies: contractors can only draft for leads they can see.
  const { data: lead, error: leadErr } = await client.from('leads').select('*').eq('id', body.lead_id).single();
  if (leadErr || !lead) return json({ error: 'Lead not found' }, 404, headers);
  // When drafting for a specific decision-maker rather than the lead's own
  // contact, override owner_name for template substitution and AI drafting
  // -- every downstream consumer (buildTemplateVars, draftEmail) already
  // reads owner_name off this object, so nothing else needs to change.
  const leadForDraft: Record<string, unknown> = body.recipient_name
    ? { ...(lead as Record<string, unknown>), owner_name: body.recipient_name }
    : (lead as Record<string, unknown>);
  // Only the exact value 'general' counts; anything else (or nothing, from older callers) is ignored.
  const generalInbox = body.recipient_kind === 'general';
  const { data: template } = await client.from('email_templates').select('*').eq('id', body.template_id).single();
  if (!template) return json({ error: 'Template not found' }, 404, headers);
  const { data: notes } = await client
    .from('lead_notes').select('content').eq('lead_id', body.lead_id)
    .order('created_at', { ascending: false }).limit(3);
  const noteTexts = (notes ?? []).map((n) => (n as { content: string }).content);
  const { data: profile } = await client.from('profiles').select('full_name, email').eq('id', userData.user.id).single();
  const contractorName = (profile?.full_name ?? profile?.email ?? 'The Dreamlabs team').split(' ')[0]!;

  // The customer profile that applies: the lead's own, else the template's. It supplies {{pain_point}}
  // when the lead has no noted pain point, and context for the AI step below.
  const icp = await loadIcp(service, (lead as { org_id: string }).org_id, resolveIcpId((lead as { icp_id?: string | null }).icp_id, template.icp_id as string | null));
  // Built-ins first, then this sender's own placeholders (their meeting link etc.) and the company-wide ones.
  const vars = applyCustomVariables(
    buildTemplateVars(leadForDraft, contractorName, noteTexts, topPainPoint(icp), { generalInbox }),
    await loadCustomVariables(service, (lead as { org_id: string }).org_id, userData.user.id),
  );
  const subject = substituteVariables(template.subject as string, vars);
  const bodyText = substituteVariables(template.body as string, vars);
  const missing = [...new Set([...subject.missing, ...bodyText.missing])];

  // The template's files travel with the draft, and its links (videos too) go at the very END of
  // the body, added AFTER any AI rewrite so the model can never drop or alter a URL.
  const attachments = onlyOrgAttachments(parseAttachments(template.attachments), (lead as { org_id: string }).org_id);
  const links = parseLinks(template.links);
  const respond = (subjectText: string, bodyOut: string, aiUsed: boolean) =>
    json({ subject: subjectText, body: appendLinks(bodyOut, links), ai_used: aiUsed, missing, attachments }, 200, headers);

  if (body.use_ai === false) {
    return respond(subject.text, bodyText.text, false);
  }
  const orgId = (lead as { org_id: string }).org_id;
  const apiKey = await resolveOrgApiKey(service, orgId, 'gemini');
  if (!apiKey) {
    return respond(subject.text, bodyText.text, false);
  }
  const { data: org } = await service.from('organizations').select('name, company_context').eq('id', orgId).maybeSingle();
  const orgName = org?.name ?? 'our team';
  try {
    const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead: leadForDraft, notes: noteTexts, contractorName, orgName, companyContext: org?.company_context, icpContext: formatIcpContext(icp), recipientTitle: body.recipient_title?.slice(0, 120) ?? null, generalInbox, apiKey });
    return respond(ai.subject, ai.body, true);
  } catch (e) {
    console.error('draftEmail failed, falling back to plain template:', e);
    return respond(subject.text, bodyText.text, false);
  }
});
