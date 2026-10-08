import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { parseSessionNotes } from '../_shared/ai.ts';
import type { SessionLeadIndexEntry } from '../_shared/ai.ts';
import { promptContacts } from '../_shared/contacts.ts';
import type { Contact } from '../_shared/contacts.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { formatProfilesForPrompt, loadOrgIcps } from '../_shared/icp.ts';

// Contacts sent to the AI: at most this many per lead, and this many overall (payload size).
const MAX_CONTACTS_PER_LEAD = 8;
const MAX_CONTACTS_TOTAL = 1500;
const LEAD_CHUNK = 100;

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

  const body = (await req.json()) as { org_id?: string; pipeline_id?: string | null; messages?: string[] };
  const orgId = String(body.org_id ?? '');
  const messages = Array.isArray(body.messages) ? body.messages.filter((m) => typeof m === 'string' && m.trim()) : [];
  if (!orgId || messages.length === 0) return json({ actions: [], error: 'org_id and at least one message are required' }, 400, headers);

  // RLS applies on this query — the caller's own JWT client, so the lead index
  // (and therefore every lead_id the AI can ever reference) is already scoped to
  // exactly what they're allowed to see. Whole-platform mode omits the pipeline
  // filter but still can't cross an org boundary, since org_id is fixed here.
  let query = client.from('leads').select('id, business_name, city, stage, pipeline_id, icp_id').eq('org_id', orgId);
  if (body.pipeline_id) query = query.eq('pipeline_id', body.pipeline_id);
  const { data: leads, error: leadsErr } = await query;
  if (leadsErr) return json({ actions: [], error: leadsErr.message }, 400, headers);
  const leadIndex: SessionLeadIndexEntry[] = (leads ?? []).map((l) => ({ id: l.id as string, business_name: l.business_name as string, city: l.city as string | null, stage: l.stage as string, icp_id: (l.icp_id as string | null) ?? null }));

  // Same RLS-scoped client as the lead index above — any org member can read
  // this via organizations_member_read, needed so the AI can propose a coherent
  // merge rather than a blind overwrite when a note describes the org itself.
  const { data: org } = await client.from('organizations').select('company_context, custom_packages').eq('id', orgId).maybeSingle();
  const currentCompanyContext = (org?.company_context as string | null) ?? null;
  const customPackages = (org?.custom_packages as string[] | null) ?? null;

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const apiKey = await resolveOrgApiKey(service, orgId, 'gemini');
  if (!apiKey) return json({ actions: [], error: 'AI unavailable' }, 200, headers);

  try {
    await attachContacts(client, leadIndex);
    const profilesBlock = formatProfilesForPrompt(await loadOrgIcps(service, orgId));
    const actions = await parseSessionNotes({ messages, leadIndex, currentCompanyContext, customPackages, profilesBlock, apiKey });
    return json({ actions }, 200, headers);
  } catch (e) {
    console.error('parse-session-notes failed:', e);
    return json({ actions: [], error: 'AI unavailable' }, 200, headers);
  }
});

/**
 * Adds each lead's usable contacts to the lead index (only leads that have any). Read
 * with the caller's RLS client, like the leads themselves, in chunks so the query
 * stays small. A failed read leaves the index without contacts: the app also drops
 * a proposed contact whose email the lead already has, so this is not a safety gate.
 */
async function attachContacts(client: ReturnType<typeof createClient>, leadIndex: SessionLeadIndexEntry[]): Promise<void> {
  const byLead = new Map<string, Contact[]>();
  for (let i = 0; i < leadIndex.length; i += LEAD_CHUNK) {
    const ids = leadIndex.slice(i, i + LEAD_CHUNK).map((l) => l.id);
    const { data, error } = await client.from('decision_maker_candidates')
      .select('id, lead_id, kind, first_name, last_name, title, label, email, phone, is_primary, include_in_sequences, dismissed_at, source')
      .in('lead_id', ids).is('dismissed_at', null).order('created_at');
    if (error) { console.error('parse-session-notes: contacts read failed:', error.message); return; }
    for (const row of (data ?? []) as (Contact & { lead_id: string })[]) {
      const list = byLead.get(row.lead_id) ?? [];
      list.push(row);
      byLead.set(row.lead_id, list);
    }
  }
  let total = 0;
  for (const lead of leadIndex) {
    const contacts = promptContacts(byLead.get(lead.id) ?? [], MAX_CONTACTS_PER_LEAD);
    if (contacts.length === 0 || total + contacts.length > MAX_CONTACTS_TOTAL) continue;
    total += contacts.length;
    lead.contacts = contacts;
  }
}
