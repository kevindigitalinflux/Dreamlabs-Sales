import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { draftEmail } from '../_shared/ai.ts';
import { buildTemplateVars, substituteVariables } from '../_shared/templateVars.ts';

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

  const body = (await req.json()) as { lead_id?: string; template_id?: string; use_ai?: boolean };
  if (!body.lead_id || !body.template_id) return json({ error: 'lead_id and template_id required' }, 400, headers);

  // RLS applies: contractors can only draft for leads they can see.
  const { data: lead, error: leadErr } = await client.from('leads').select('*').eq('id', body.lead_id).single();
  if (leadErr || !lead) return json({ error: 'Lead not found' }, 404, headers);
  const { data: template } = await client.from('email_templates').select('*').eq('id', body.template_id).single();
  if (!template) return json({ error: 'Template not found' }, 404, headers);
  const { data: notes } = await client
    .from('lead_notes').select('content').eq('lead_id', body.lead_id)
    .order('created_at', { ascending: false }).limit(3);
  const noteTexts = (notes ?? []).map((n) => (n as { content: string }).content);
  const { data: profile } = await client.from('profiles').select('full_name, email').eq('id', userData.user.id).single();
  const contractorName = (profile?.full_name ?? profile?.email ?? 'The Dreamlabs team').split(' ')[0]!;

  const vars = buildTemplateVars(lead as Record<string, unknown>, contractorName, noteTexts);
  const subject = substituteVariables(template.subject as string, vars);
  const bodyText = substituteVariables(template.body as string, vars);
  const missing = [...new Set([...subject.missing, ...bodyText.missing])];

  if (body.use_ai === false) {
    return json({ subject: subject.text, body: bodyText.text, ai_used: false, missing }, 200, headers);
  }
  try {
    const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead: lead as Record<string, unknown>, notes: noteTexts, contractorName });
    return json({ subject: ai.subject, body: ai.body, ai_used: true, missing }, 200, headers);
  } catch (e) {
    console.error('draftEmail failed, falling back to plain template:', e);
    return json({ subject: subject.text, body: bodyText.text, ai_used: false, missing }, 200, headers);
  }
});
