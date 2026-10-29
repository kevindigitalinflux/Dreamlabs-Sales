// supabase/functions/suggest-sequence/index.ts
// POST { lead_id } with the user's JWT. Suggests which of the org's email sequences fits a lead best, using the same
// helper and id validation as the autopilot (chooseSequenceClaude + pickSequence). The model can only ever return
// an id from the list we give it. Normal user JWT (default verify_jwt): no config entry needed.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { chooseSequenceClaude } from '../_shared/ai.ts';
import { pickSequence } from '../_shared/autopilotChoices.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { bareDomain } from '../_shared/domain.ts';

interface SequenceRow {
  id: string; name: string; description: string | null; category: string | null; icp_id: string | null;
  steps: unknown[] | null;
}

const MAX_NOTES = 5;
const NOTE_CHARS = 240;
const RATE_MAX = 30;
const RATE_WINDOW_MINUTES = 60;

/** The one response shape, for every outcome the client should show as plain text. */
function result(sequenceId: string | null, sequenceName: string | null, reason: string) {
  return { sequence_id: sequenceId, sequence_name: sequenceName, reason };
}

/** A compact, bounded text of the lead facts the model may use (all of it is untrusted data, handled as such by the helper). */
function leadFacts(lead: Record<string, unknown>, notes: string[]): string {
  const domain = typeof lead.website === 'string' && lead.website ? bareDomain(lead.website) : null;
  const parts = [
    domain ? `Website domain: ${domain}` : '',
    typeof lead.pain_point === 'string' && lead.pain_point ? `Pain point: ${lead.pain_point.slice(0, NOTE_CHARS)}` : '',
    ...notes.map((n) => `Note: ${n}`),
  ];
  return parts.filter(Boolean).join('\n');
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  try {
    const client = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );
    const { data: userData } = await client.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'Not signed in' }, 401, headers);

    let leadId = '';
    try {
      const body = (await req.json()) as { lead_id?: unknown };
      leadId = typeof body?.lead_id === 'string' ? body.lead_id : '';
    } catch { /* falls through to the 400 below */ }
    if (!leadId) return json({ error: 'lead_id is required' }, 400, headers);

    // RLS-scoped read: the caller only gets a lead they are allowed to see.
    const { data: lead } = await client.from('leads').select('*').eq('id', leadId).maybeSingle();
    if (!lead) return json({ error: 'Lead not found' }, 404, headers);
    const orgId = (lead as { org_id: string }).org_id;

    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: membership } = await service.from('org_members').select('role').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
    if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

    // A lead already in a sequence needs no suggestion (and no AI spend).
    const { data: open } = await service.from('sequence_enrollments').select('id').eq('lead_id', leadId).in('status', ['active', 'paused']).limit(1);
    if ((open ?? []).length > 0) return json(result(null, null, 'This lead is already in a sequence'), 200, headers);

    const { data: seqData } = await service.from('email_sequences')
      .select('id, name, description, category, icp_id, steps')
      .or(`org_id.is.null,org_id.eq.${orgId}`).eq('is_active', true);
    const sequences = ((seqData ?? []) as SequenceRow[]).filter((s) => Array.isArray(s.steps) && s.steps.length > 0);
    if (sequences.length === 0) return json(result(null, null, 'There are no sequences to choose from yet'), 200, headers);

    const apiKey = await resolveOrgApiKey(service, orgId, 'anthropic');
    if (!apiKey) return json(result(null, null, 'No AI key set up for this organization'), 200, headers);

    const allowed = await checkRateLimit(service, `suggest-seq:${orgId}:${userId}`, RATE_MAX, RATE_WINDOW_MINUTES);
    if (!allowed) return json({ error: 'Too many suggestions in the last hour. Please try again later.' }, 429, headers);

    const { data: noteRows } = await client.from('lead_notes').select('content')
      .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(MAX_NOTES);
    const notes = ((noteRows ?? []) as { content: string | null }[])
      .map((n) => (n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_CHARS)).filter(Boolean);

    const icpId = typeof (lead as { icp_id?: unknown }).icp_id === 'string' ? (lead as { icp_id: string }).icp_id : null;
    let aiPickedId: string | null = null;
    try {
      aiPickedId = await chooseSequenceClaude({
        sequences: sequences.map((s) => ({ id: s.id, name: s.name, description: s.description, category: s.category })),
        lead: lead as Record<string, unknown>, researchSummary: leadFacts(lead as Record<string, unknown>, notes), apiKey,
      });
    } catch (e) {
      console.error('suggest-sequence: AI pick failed', e instanceof Error ? e.name : 'error');
    }

    const list = sequences.map((s) => ({ id: s.id, icp_id: s.icp_id }));
    // Same validation as the autopilot: the AI id only counts if it is in the list; the profile match is the fallback.
    const aiOnly = pickSequence({ enrolledSequenceId: null, aiPickedId, icpId: null, sequences: list });
    const picked = aiOnly ?? pickSequence({ enrolledSequenceId: null, aiPickedId: null, icpId, sequences: list });
    const chosen = picked ? sequences.find((s) => s.id === picked) : undefined;
    if (!chosen) return json(result(null, null, 'No sequence is a clear fit for this lead'), 200, headers);
    const reason = aiOnly
      ? 'Picked by AI from the lead details and your sequence descriptions'
      : 'Matches the lead\'s customer profile';
    return json(result(chosen.id, chosen.name, reason), 200, headers);
  } catch (e) {
    console.error('suggest-sequence failed', e instanceof Error ? e.name : 'error');
    return json(result(null, null, 'Could not suggest a sequence right now'), 200, headers);
  }
});
