import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { parseNotes } from '../_shared/ai.ts';

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
  try {
    const suggestion = await parseNotes({ note: String(body.note ?? ''), lead: lead as Record<string, unknown> });
    return json({ suggestion }, 200, headers);
  } catch (e) {
    console.error('parse-notes failed:', e);
    return json({ suggestion: null, error: 'AI unavailable' }, 200, headers);
  }
});
