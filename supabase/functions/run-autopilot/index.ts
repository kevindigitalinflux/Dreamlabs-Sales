// supabase/functions/run-autopilot/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';

const HEADERS = { 'Content-Type': 'application/json' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

interface AutopilotRun {
  id: string; org_id: string; created_by: string; icp_raw_input: string; icp_params: Record<string, unknown>;
  source: 'google_places' | 'companies_house'; daily_lead_target: number; ends_at: string;
  leads_scraped_total: number; outreach_sent_total: number;
}

/** Same rating/review/industry fit check check-sequences applies before an outreach AI pass. */
function tightIcpFit(lead: Record<string, unknown>, icp: Record<string, unknown>): boolean {
  const rating = lead.google_rating as number | null;
  const reviews = lead.review_count as number | null;
  const industry = (icp.industry as string | null)?.toLowerCase();
  const vertical = (lead.vertical as string | null)?.toLowerCase();
  const ratingOk = rating == null || ((icp.min_rating == null || rating >= (icp.min_rating as number)) && (icp.max_rating == null || rating <= (icp.max_rating as number)));
  const reviewsOk = reviews == null || icp.max_reviews == null || reviews <= (icp.max_reviews as number);
  const industryOk = !industry || !vertical || vertical.includes(industry);
  return ratingOk && reviewsOk && industryOk;
}

/**
 * Auto-approves pending raw_leads from this run's own scrape job (only —
 * never the org's wider pending backlog, see jobId below) through four
 * sequential guardrails — data completeness, blocklist, re-dedup, ICP fit.
 * Each candidate either fails a guardrail (`continue`, skipping only that
 * candidate) or falls through every guardrail and gets approved; there is no
 * path that approves a candidate without passing all four.
 */
async function autoApprove(service: SupabaseClient, run: AutopilotRun, jobId: string): Promise<number> {
  // Scoped to this run's own scrape_job_id, not every status='pending' row
  // for the org — otherwise autopilot would silently bulldoze rows a human
  // deliberately left pending via the review table's "Skip" action, and
  // daily_lead_target would only ever be honoured on the scrape *request*,
  // not on what actually gets approved. scrape_jobs!inner(org_id) is kept as
  // defense-in-depth even though scrape_job_id alone already implies the org
  // (this job was created moments ago by the fetch below, for run.org_id).
  const { data: rawLeads } = await service.from('raw_leads')
    .select('*, scrape_jobs!inner(org_id)').eq('scrape_job_id', jobId).eq('scrape_jobs.org_id', run.org_id).eq('status', 'pending');
  if (!rawLeads || rawLeads.length === 0) return 0;

  const { data: blocklist } = await service.from('outreach_blocklist').select('value').eq('org_id', run.org_id);
  const blocked = new Set((blocklist ?? []).map((b) => (b as { value: string }).value.toLowerCase()));

  const { data: existingLeads } = await service.from('leads').select('business_name, city, email').eq('org_id', run.org_id);
  const { data: existingRaw } = await service.from('raw_leads')
    .select('business_name, city, email, scrape_jobs!inner(org_id)').eq('scrape_jobs.org_id', run.org_id).eq('status', 'approved');
  const seen = [...(existingLeads ?? []), ...(existingRaw ?? [])];

  let approved = 0;
  for (const rl of rawLeads) {
    const lead = rl as Record<string, unknown> & { id: string; email: string | null; phone: string | null; website: string | null; business_name: string; city: string | null };

    // Guardrail 1: data completeness — must have an email, and at least one of phone/website.
    if (!lead.email) continue;
    if (!lead.phone && !lead.website) continue;

    // Guardrail 2: blocklist — email or its domain.
    const domain = lead.email.split('@')[1]?.toLowerCase();
    if (blocked.has(lead.email.toLowerCase()) || (domain && blocked.has(domain))) continue;

    // Guardrail 3: re-dedup — same email match, or business_name+city match
    // (case-insensitive), mirroring scrape-google-places's isDuplicate exactly.
    const alreadySeen = seen.some((s) =>
      (s.email && lead.email && s.email.toLowerCase() === lead.email.toLowerCase()) ||
      (s.business_name.toLowerCase() === lead.business_name.toLowerCase() && (s.city ?? '').toLowerCase() === (lead.city ?? '').toLowerCase()),
    );
    if (alreadySeen) continue;

    // Guardrail 4: tight ICP fit.
    if (!tightIcpFit(lead, run.icp_params)) continue;

    const { error: insertErr } = await service.from('leads').insert({
      business_name: lead.business_name, owner_name: lead.owner_name ?? null, phone: lead.phone,
      email: lead.email, website: lead.website, address: lead.address ?? null, city: lead.city,
      postcode: lead.postcode ?? null, google_rating: lead.google_rating ?? null, review_count: lead.review_count ?? null,
      vertical: lead.vertical ?? null, stage: 'new_lead', org_id: run.org_id,
      created_by: null, raw_lead_id: lead.id,
    });
    if (insertErr) continue;
    await service.from('raw_leads').update({ status: 'approved', approved_by: null, approved_at: new Date().toISOString() }).eq('id', lead.id);
    // Extend `seen` in-memory so a later duplicate within this same batch
    // (e.g. two raw_leads that both matched the same business) is also caught.
    seen.push({ business_name: lead.business_name, city: lead.city, email: lead.email });
    approved++;
  }
  return approved;
}

/**
 * Cron target for `run-autopilot-daily` (migration 006): for every active
 * autopilot_runs row, triggers that org's Google Places scrape (capped via
 * max_results per Task 8; Companies House runs are cancelled outright — see
 * below), gives the background scrape job a moment to land results, then
 * auto-approves only that job's own pending raw_leads through the four
 * guardrails above and tracks progress counters. Auth is a shared secret
 * header (no user JWT — pg_cron has none), same pattern as
 * check-sequences/auto-enroll-cold-outreach/check-replies.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, HEADERS);
  const cronSecret = Deno.env.get('CRON_SECRET')!;
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Forbidden' }, 403, HEADERS);
  }

  const service = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: runs } = await service.from('autopilot_runs').select('*').eq('status', 'active');
  let processed = 0;

  for (const r of (runs ?? []) as AutopilotRun[]) {
    if (new Date(r.ends_at) <= new Date()) {
      await service.from('autopilot_runs').update({ status: 'completed' }).eq('id', r.id);
      continue;
    }

    // Companies House raw_leads carry no email/phone/website columns at all
    // (CH's API returns no contact details — those only ever arrive via the
    // manual Apollo/Hunter enrichment buttons, which autopilot never calls).
    // Every CH candidate would fail autoApprove's Guardrail 1 (email
    // required) forever, so a CH autopilot run would otherwise silently burn
    // API calls and days with leads_scraped_total stuck at 0 and no error
    // anywhere to explain why. Cancel it outright instead. (Defensive net —
    // the autopilot setup UI's source picker should stop offering this
    // option entirely; this is the backend backstop in case a row is ever
    // created with that source some other way.)
    if (r.source === 'companies_house') {
      await service.from('autopilot_runs').update({
        status: 'cancelled',
        cancel_reason: 'Companies House is not yet supported for autopilot — it returns no contact details, so no lead can ever pass the email-required guardrail. Use Google Places instead.',
      }).eq('id', r.id);
      processed++;
      continue;
    }

    // Only google_places reaches here now (companies_house is cancelled above).
    // Each scraper enforces its own hard ceiling internally (60 Places per
    // Task 8) regardless of what's sent here — this cap only avoids asking
    // for more than the run's own daily target.
    const cap = Math.min(60, r.daily_lead_target);
    try {
      const scrapeRes = await fetch(`${SUPABASE_URL}/functions/v1/scrape-google-places`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Authorization satisfies the platform gateway's verify_jwt check
          // (a service-role key is a validly-signed JWT); x-cron-secret is
          // the app-level bypass the scraper functions use to skip their
          // normal auth.getUser() user check, which a service-role key (no
          // `sub` claim) could never satisfy — see the scraper functions'
          // own comments on this for the full rationale.
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'x-cron-secret': cronSecret,
        },
        body: JSON.stringify({ org_id: r.org_id, icp_raw_input: r.icp_raw_input, icp_params: r.icp_params, max_results: cap }),
      });
      if (!scrapeRes.ok) {
        console.error(`autopilot ${r.id}: scrape trigger failed`, await scrapeRes.text());
      } else {
        // job_id from the scraper's response is what scopes autoApprove to
        // *this run's own* scrape results — without it, autoApprove would
        // have to fall back to the org's whole pending backlog (wrong: would
        // bulldoze rows a human deliberately left pending via the review
        // table's "Skip" action, and ignore daily_lead_target entirely on
        // the approval side).
        const scrapeData = await scrapeRes.json() as { job_id?: string };
        const jobId = scrapeData.job_id;
        if (jobId) {
          // Give the background scrape job a moment before approving — it
          // runs via EdgeRuntime.waitUntil in the scraper function and
          // typically completes well within this window for a small
          // daily_lead_target. autoApprove only ever touches rows already
          // status='pending' for this exact job_id, so if the job is still
          // `running` when this checks (the 15s wait is a rough estimate,
          // not a guarantee), its results simply get picked up on
          // tomorrow's run instead of being lost.
          await new Promise((res) => setTimeout(res, 15000));
          const approvedCount = await autoApprove(service, r, jobId);
          // r.leads_scraped_total is this invocation's own fresh read of the
          // row (from the `select('*')` above) and each run is processed
          // exactly once per invocation (autopilot_runs_one_active_per_org
          // guarantees at most one active row per org), so this is a correct
          // increment — not the stale-cached-counter bug class
          // check-sequences had for actual_ai_cost_cents.
          await service.from('autopilot_runs').update({
            leads_scraped_total: r.leads_scraped_total + approvedCount,
          }).eq('id', r.id);
        }
      }
    } catch (e) {
      console.error(`autopilot ${r.id}: scrape trigger error`, e);
    }
    processed++;
  }

  return json({ processed }, 200, HEADERS);
});
