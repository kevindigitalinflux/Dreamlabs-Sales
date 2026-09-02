import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { runBounded } from '../_shared/concurrency.ts';

interface IcpParams {
  industry: string | null; location: string | null; city: string | null;
  country: 'GB' | 'US' | 'other'; min_staff: number | null;
  min_rating: number | null; max_rating: number | null; max_reviews: number | null;
  keywords: string[];
}

interface PlaceResult {
  place_id: string; name: string; formatted_address?: string;
  rating?: number; user_ratings_total?: number;
}

/** Best-effort: fetch a business website and pull the first plausible contact email from it. */
async function findEmail(website: string | undefined): Promise<string | null> {
  if (!website) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(website, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    const mailto = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (mailto) return mailto[1];
    const plain = html.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/);
    return plain ? plain[0] : null;
  } catch {
    return null; // timeout, network error, or a hostile/broken site — never fail the job for this
  }
}

async function fetchPlaceDetails(placeId: string, apiKey: string): Promise<{ phone: string | null; website: string | null }> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return { phone: null, website: null };
  const data = await res.json() as { result?: { formatted_phone_number?: string; website?: string } };
  return { phone: data.result?.formatted_phone_number ?? null, website: data.result?.website ?? null };
}

function buildQuery(icp: IcpParams): string {
  const parts = [icp.industry, icp.city ?? icp.location, ...icp.keywords].filter(Boolean);
  return parts.join(' ');
}

async function runScrapeJob(service: SupabaseClient, jobId: string, orgId: string, icp: IcpParams, apiKey: string) {
  try {
    await service.from('scrape_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', jobId);

    const query = buildQuery(icp);
    const allPlaces: PlaceResult[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 3 && allPlaces.length < 60; page++) {
      const url = pageToken
        ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pageToken}&key=${apiKey}`
        : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
      const res = await fetch(url);
      const data = await res.json() as { results?: PlaceResult[]; next_page_token?: string; status: string };
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        throw new Error(`Google Places ${data.status}`);
      }
      allPlaces.push(...(data.results ?? []));
      pageToken = data.next_page_token;
      if (!pageToken) break;
      // Google requires a short delay before a next_page_token becomes valid.
      await new Promise((r) => setTimeout(r, 2000));
    }
    const places = allPlaces.slice(0, 60);

    // Existing org data for duplicate detection — fetched once, matched in-memory.
    const { data: existingLeads } = await service.from('leads')
      .select('business_name, city, email').eq('org_id', orgId);
    const { data: existingRaw } = await service.from('raw_leads')
      .select('business_name, city, email, scrape_jobs!inner(org_id)').eq('scrape_jobs.org_id', orgId).eq('status', 'pending');
    const seen = [...(existingLeads ?? []), ...(existingRaw ?? [])];
    function isDuplicate(businessName: string, city: string | null, email: string | null): boolean {
      return seen.some((s) =>
        (s.email && email && s.email.toLowerCase() === email.toLowerCase()) ||
        (s.business_name.toLowerCase() === businessName.toLowerCase() && (s.city ?? '').toLowerCase() === (city ?? '').toLowerCase()),
      );
    }

    // Bounded concurrency: Place Details + website email lookup per result.
    // Sized to comfortably clear 60 results inside Supabase's 150s Free-plan
    // background-task ceiling even if every site times out (concurrency 8 x
    // ~5s worst case per item = ~38s for 60 items).
    const enriched = await runBounded(places, 8, async (place) => {
      const details = await fetchPlaceDetails(place.place_id, apiKey);
      const email = await findEmail(details.website ?? undefined);
      return { place, details, email };
    });

    const rows = enriched.map(({ place, details, email }) => {
      const city = icp.city ?? null;
      const duplicate = isDuplicate(place.name, city, email);
      return {
        scrape_job_id: jobId,
        business_name: place.name,
        phone: details.phone,
        email,
        website: details.website,
        address: place.formatted_address ?? null,
        city,
        google_rating: place.rating ?? null,
        review_count: place.user_ratings_total ?? null,
        vertical: icp.industry,
        source: 'google_places',
        source_id: place.place_id,
        raw_data: { place, details },
        status: duplicate ? 'duplicate' : 'pending',
      };
    });

    if (rows.length > 0) {
      const { error: insertErr } = await service.from('raw_leads').insert(rows);
      if (insertErr) throw new Error(insertErr.message);
    }

    await service.from('scrape_jobs').update({
      status: 'completed', results_count: rows.length, completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  } catch (e) {
    await service.from('scrape_jobs').update({
      status: 'failed', error_message: e instanceof Error ? e.message : String(e), completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  }
}

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

  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams };
  const orgId = String(body.org_id ?? '');
  if (!orgId || !body.icp_params) return json({ error: 'org_id and icp_params are required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const apiKey = await resolveOrgApiKey(service, orgId, 'google_places');
  if (!apiKey) return json({ error: 'No Google Places API key configured for this organization' }, 400, headers);

  const { data: job, error: jobErr } = await service.from('scrape_jobs').insert({
    org_id: orgId, created_by: userData.user.id, icp_raw_input: body.icp_raw_input ?? null,
    icp_params: body.icp_params, sources: ['google_places'], status: 'pending',
  }).select('id').single();
  if (jobErr || !job) return json({ error: jobErr?.message ?? 'Could not create job' }, 500, headers);

  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(runScrapeJob(service, job.id, orgId, body.icp_params, apiKey));

  return json({ job_id: job.id }, 200, headers);
});
