import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const AI_MODEL = 'gemini-3.6-flash'; // keep in sync with _shared/ai.ts

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

  const body = (await req.json()) as { raw_input?: string; org_id?: string };
  const rawInput = String(body.raw_input ?? '').trim();
  const orgId = String(body.org_id ?? '');
  if (!rawInput) return json({ error: 'raw_input is required' }, 400, headers);
  if (!orgId) return json({ error: 'org_id is required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const apiKey = await resolveOrgApiKey(service, orgId, 'gemini');
  if (!apiKey) return json({ error: 'No Gemini API key configured for this organization' }, 400, headers);

  const prompt = `You are an ICP parser for a B2B sales tool. Convert the user's natural language
description of their ideal customer into structured JSON search parameters.

Return ONLY valid JSON matching this exact shape, no other text:
{"industry": string|null, "location": string|null, "city": string|null, "country": "GB"|"US"|"other", "min_staff": number|null, "min_rating": number|null, "max_rating": number|null, "max_reviews": number|null, "keywords": string[]}

"country" must be "GB" if the location is in the United Kingdom, "US" if in the United States, "other" otherwise.
If the user gives a rating range, split it into min_rating/max_rating. If unspecified, use null.
"keywords" is a short list of extra search terms useful for a location-based business search (e.g. the industry name, near-synonyms).

USER'S DESCRIPTION:
${rawInput}`;

  try {
    const res = await fetch(`${GEMINI_URL}/${AI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    });
    if (!res.ok) return json({ error: `Gemini ${res.status}: ${(await res.text()).slice(0, 300)}` }, 502, headers);
    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: 'Gemini returned no content' }, 502, headers);
    const params = JSON.parse(text);
    return json({ params }, 200, headers);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500, headers);
  }
});
