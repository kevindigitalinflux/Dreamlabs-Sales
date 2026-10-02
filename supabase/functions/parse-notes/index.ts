import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { parseNotes } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { formatIcpContext, formatProfilesForPrompt, loadOrgIcps } from '../_shared/icp.ts';

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

  const body = (await req.json()) as { lead_id?: string; note?: string };
  if (!body.lead_id || !body.note) return json({ error: 'lead_id and note required' }, 400, headers);

  // RLS applies: contractors can only parse notes for leads they can see.
  const { data: lead, error: leadErr } = await client.from('leads').select('*').eq('id', body.lead_id).single();
  if (leadErr || !lead) return json({ error: 'Lead not found' }, 404, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const orgId = (lead as { org_id: string }).org_id;
  const apiKey = await resolveOrgApiKey(service, orgId, 'gemini');
  if (!apiKey) return json({ suggestion: null, error: 'AI unavailable' }, 200, headers);
  const { data: org } = await service.from('organizations').select('custom_packages').eq('id', orgId).maybeSingle();
  const customPackages = (org?.custom_packages as string[] | null) ?? null;
  // Every profile this org has (so the AI can say which one the lead matches) and the lead's own, in full.
  const orgIcps = await loadOrgIcps(service, orgId);
  const profilesBlock = formatProfilesForPrompt(orgIcps);
  const icpContext = formatIcpContext(orgIcps.find((p) => p.id === (lead as { icp_id?: string | null }).icp_id) ?? null);
  try {
    const suggestion = await parseNotes({ note: String(body.note ?? ''), lead: lead as Record<string, unknown>, customPackages, icpContext, profilesBlock, apiKey });
    return json({ suggestion }, 200, headers);
  } catch (e) {
    console.error('parse-notes failed:', e);
    return json({ suggestion: null, error: 'AI unavailable' }, 200, headers);
  }
});
