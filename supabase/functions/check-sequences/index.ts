import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';
import { draftEmail, draftEmailClaude, generateLeadNotes } from '../_shared/ai.ts';
import type { ClaudeModel } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { buildTemplateVars, substituteVariables } from '../_shared/templateVars.ts';

interface Step { delay_days: number; template_type: string; subject_override: string | null }

// Deno copy of advanceEnrollment from src/lib/sequenceMath.ts — keep in sync.
function advance(currentStep: number, steps: Step[], now: Date) {
  const next = currentStep + 1;
  if (next > steps.length) return { current_step: currentStep, next_send_at: null, status: 'completed' };
  return { current_step: next, next_send_at: new Date(now.getTime() + steps[next - 1]!.delay_days * 86_400_000).toISOString(), status: 'active' };
}

const HEADERS = { 'Content-Type': 'application/json' };
const OUTREACH_PREFIXES = ['cold_outreach_', 'jv_pitch_'];
function isOutreachTemplate(templateType: string): boolean {
  return OUTREACH_PREFIXES.some((p) => templateType.startsWith(p));
}
const OUTREACH_SEQUENCE_NAMES = ['Cold outreach default', 'JV pitch default'];

/** ramp-up: day 1-4 of an active autopilot run scale the daily send cap. */
function rampedCap(dailyTarget: number, dayNumber: number): number {
  const pct = dayNumber === 1 ? 0.25 : dayNumber === 2 ? 0.5 : dayNumber === 3 ? 0.75 : 1;
  return Math.max(1, Math.ceil(dailyTarget * pct));
}

/**
 * Cron target for `check-sequences-daily` (migration 002): drafts the next due
 * step for every active enrollment, then advances or completes it. Auth is a
 * shared secret header (no user JWT — pg_cron has none), never the Supabase
 * anon/service keys.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, HEADERS);
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return json({ error: 'Forbidden' }, 403, HEADERS);
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: due } = await service
    .from('sequence_enrollments')
    .select('*, sequence:email_sequences(*), lead:leads(*)')
    .eq('status', 'active')
    .lte('next_send_at', new Date().toISOString());

  // Autopilot throttle state, computed once per org as it's needed.
  const autopilotByOrg = new Map<string, { dailyOutreachTarget: number; dayNumber: number; rampUp: boolean; maxSpendCents: number | null; actualSpendCents: number; outreachSentTotal: number; runId: string } | null>();
  const sentTodayByOrg = new Map<string, number>();
  const outreachSeqIdsByOrg = new Map<string, string[]>();
  // Guards against redundant cancel writes if multiple enrollments in the
  // same org hit the spend cap within one invocation.
  const cancelledRunsThisInvocation = new Set<string>();

  let drafted = 0;
  const skipped: { id: string; reason: string }[] = [];

  for (const row of due ?? []) {
    const enrollment = row as Record<string, unknown> & {
      id: string; current_step: number; enrolled_by: string | null;
      sequence: { steps: Step[]; auto_draft_on_reply: boolean } | null;
      lead: Record<string, unknown> | null;
    };
    const steps = enrollment.sequence?.steps ?? [];
    const step = steps[enrollment.current_step - 1];
    const lead = enrollment.lead;
    if (!step || !lead) { skipped.push({ id: enrollment.id, reason: 'missing step or lead' }); continue; }
    if (!lead.email) { skipped.push({ id: enrollment.id, reason: 'lead has no email' }); continue; }

    const orgId = lead.org_id as string;
    const outreach = isOutreachTemplate(step.template_type);

    // Autopilot daily throttle — only applies to outreach templates in an org with an active run.
    if (outreach) {
      if (!autopilotByOrg.has(orgId)) {
        const { data: run } = await service.from('autopilot_runs')
          .select('id, daily_outreach_target, ramp_up_enabled, started_at, max_total_spend_cents, actual_ai_cost_cents, outreach_sent_total')
          .eq('org_id', orgId).eq('status', 'active').maybeSingle();
        if (run) {
          const dayNumber = Math.max(1, Math.floor((Date.now() - new Date(run.started_at).getTime()) / 86_400_000) + 1);
          autopilotByOrg.set(orgId, {
            dailyOutreachTarget: run.daily_outreach_target, dayNumber, rampUp: run.ramp_up_enabled,
            maxSpendCents: run.max_total_spend_cents, actualSpendCents: run.actual_ai_cost_cents,
            outreachSentTotal: run.outreach_sent_total, runId: run.id,
          });
        } else {
          autopilotByOrg.set(orgId, null);
        }
      }
      const autopilot = autopilotByOrg.get(orgId);
      if (autopilot) {
        if (autopilot.maxSpendCents != null && autopilot.actualSpendCents >= autopilot.maxSpendCents) {
          skipped.push({ id: enrollment.id, reason: 'autopilot spend cap reached' });
          // Close both halves of the guardrail: stop drafting this
          // enrollment AND cancel the run itself, so run-autopilot stops
          // scraping/approving for it too. Once per run per invocation.
          if (!cancelledRunsThisInvocation.has(autopilot.runId)) {
            cancelledRunsThisInvocation.add(autopilot.runId);
            await service.from('autopilot_runs')
              .update({ status: 'cancelled', cancel_reason: 'total spend cap reached' })
              .eq('id', autopilot.runId);
          }
          continue;
        }
        const cap = autopilot.rampUp ? rampedCap(autopilot.dailyOutreachTarget, autopilot.dayNumber) : autopilot.dailyOutreachTarget;
        if (!sentTodayByOrg.has(orgId)) {
          // Scope "sent today" to outreach-sequence enrollments only — otherwise a
          // contractor's manual sends, cycle-2's own non-outreach drafting, or even
          // approving yesterday's outreach draft today would all silently eat into
          // today's autopilot allowance.
          if (!outreachSeqIdsByOrg.has(orgId)) {
            const { data: outreachSeqs } = await service.from('email_sequences')
              .select('id').eq('org_id', orgId).in('name', OUTREACH_SEQUENCE_NAMES);
            outreachSeqIdsByOrg.set(orgId, (outreachSeqs ?? []).map((s) => (s as { id: string }).id));
          }
          const outreachSeqIds = outreachSeqIdsByOrg.get(orgId)!;
          const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
          const { count } = await service.from('email_logs')
            .select('id, sequence_enrollments!inner(sequence_id)', { count: 'exact', head: true })
            .eq('org_id', orgId).gte('sent_at', startOfDay.toISOString())
            .in('sequence_enrollments.sequence_id', outreachSeqIds);
          sentTodayByOrg.set(orgId, count ?? 0);
        }
        const sentToday = sentTodayByOrg.get(orgId)!;
        if (sentToday >= cap) { skipped.push({ id: enrollment.id, reason: 'autopilot daily cap reached' }); continue; }
      }
    }

    // Org-scoped template first (the new cold_outreach_*/jv_pitch_* templates are
    // seeded per-org), falling back to the global org_id=null default that every
    // pre-existing cycle-2 template type still uses exclusively.
    const { data: templates } = await service
      .from('email_templates').select('*')
      .eq('template_type', step.template_type).eq('is_default', true)
      .or(`org_id.eq.${orgId},org_id.is.null`);
    const template = (templates ?? []).find((t) => (t as { org_id: string | null }).org_id === orgId)
      ?? (templates ?? []).find((t) => (t as { org_id: string | null }).org_id === null)
      ?? null;
    if (!template) { skipped.push({ id: enrollment.id, reason: `no default template ${step.template_type}` }); continue; }

    // enrolled_by is null for every auto-enrolled outreach lead (the
    // system-generated convention this cycle establishes) — only look up a
    // profile when there's an actual human to resolve, and only ever run
    // .split(' ')[0] on a real resolved name/email. The system fallback is
    // a complete phrase with no further processing, so it can never be
    // truncated into something broken like "Best, The".
    let contractorName = 'the team';
    if (enrollment.enrolled_by) {
      const { data: enroller } = await service
        .from('profiles').select('full_name, email').eq('id', enrollment.enrolled_by).maybeSingle();
      const resolvedName = enroller?.full_name ?? enroller?.email;
      if (resolvedName) contractorName = resolvedName.split(' ')[0]!;
    }
    const { data: notesRows } = await service
      .from('lead_notes').select('content').eq('lead_id', lead.id as string)
      .order('created_at', { ascending: false }).limit(5);
    const noteTexts = (notesRows ?? []).map((n) => (n as { content: string }).content);

    const vars = buildTemplateVars(lead, contractorName, noteTexts);
    const subject = substituteVariables((step.subject_override ?? template.subject) as string, vars);
    const bodyText = substituteVariables(template.body as string, vars);

    let finalSubject = subject.text;
    let finalBody = bodyText.text;

    if (outreach) {
      const apiKey = await resolveOrgApiKey(service, orgId, 'anthropic');
      if (!apiKey) { skipped.push({ id: enrollment.id, reason: 'no anthropic key configured' }); continue; }

      // Real existence checks, not a derivation from the 5-row recency-window
      // fetch above — a lead can easily accumulate 5+ notes newer than its
      // ai_summary (stage-change auto-logging, reply detection), and a recency
      // window would then miss the old ai_summary row and fire a second,
      // unbudgeted Sonnet notes pass for the same lead.
      const { count: aiSummaryCount } = await service.from('lead_notes')
        .select('id', { count: 'exact', head: true })
        .eq('lead_id', lead.id as string).eq('note_type', 'ai_summary');
      const hasAiSummary = (aiSummaryCount ?? 0) > 0;
      const { count: humanNoteCount } = await service.from('lead_notes')
        .select('id', { count: 'exact', head: true })
        .eq('lead_id', lead.id as string).neq('note_type', 'ai_summary');
      const hasHumanNote = (humanNoteCount ?? 0) > 0;

      // Compatible-lead gate for the notes pass: priority flag, OR tight ICP
      // fit (JV pitch has no scrape_job to check against — always qualifies),
      // OR a human already left a note. AI-generated notes don't count
      // towards this on their own (checked separately as hasAiSummary).
      let tightIcpFit = step.template_type.startsWith('jv_pitch_');
      let icpParams: Record<string, unknown> | null = null;
      if (!tightIcpFit && lead.raw_lead_id) {
        const { data: rawLead } = await service.from('raw_leads')
          .select('scrape_jobs(icp_params)').eq('id', lead.raw_lead_id as string).maybeSingle();
        const params = (rawLead as { scrape_jobs: { icp_params: Record<string, unknown> } | null } | null)?.scrape_jobs?.icp_params ?? null;
        icpParams = params;
        if (params) {
          const rating = lead.google_rating as number | null;
          const reviews = lead.review_count as number | null;
          const industry = (params.industry as string | null)?.toLowerCase();
          const vertical = (lead.vertical as string | null)?.toLowerCase();
          const ratingOk = rating == null || ((params.min_rating == null || rating >= (params.min_rating as number)) && (params.max_rating == null || rating <= (params.max_rating as number)));
          const reviewsOk = reviews == null || params.max_reviews == null || reviews <= (params.max_reviews as number);
          const industryOk = !industry || !vertical || vertical.includes(industry);
          tightIcpFit = ratingOk && reviewsOk && industryOk;
        }
      }
      const compatible = (lead.is_priority as boolean) || tightIcpFit || hasHumanNote;

      if (!hasAiSummary && compatible) {
        try {
          const notesText = await generateLeadNotes({ lead, icpParams, apiKey });
          await service.from('lead_notes').insert({
            lead_id: lead.id, created_by: null, note_type: 'ai_summary', content: notesText,
          });
          noteTexts.unshift(notesText);
        } catch (e) {
          console.error(`generateLeadNotes failed for lead ${lead.id}, continuing without it:`, e);
        }
      }

      const model: ClaudeModel = 'claude-haiku-4-5';
      try {
        const { data: org } = await service.from('organizations').select('name').eq('id', orgId).maybeSingle();
        const orgName = org?.name ?? 'our team';
        const ai = await draftEmailClaude({ subject: subject.text, body: bodyText.text, lead, notes: noteTexts, contractorName, orgName, apiKey, model });
        finalSubject = ai.subject; finalBody = ai.body;
        const ap = autopilotByOrg.get(orgId);
        if (ap) {
          const costCents = 1; // rough per-draft accounting, see run-autopilot's estimate math
          ap.actualSpendCents += costCents;
          await service.from('autopilot_runs').update({ actual_ai_cost_cents: ap.actualSpendCents }).eq('id', ap.runId);
        }
      } catch (e) {
        console.error(`Claude draft failed for enrollment ${enrollment.id}, using plain template:`, e);
      }
    } else {
      const apiKey = await resolveOrgApiKey(service, orgId, 'gemini');
      if (apiKey) {
        try {
          const { data: org } = await service.from('organizations').select('name').eq('id', orgId).maybeSingle();
          const orgName = org?.name ?? 'our team';
          // Only the first 3 (of up to 5 fetched) — preserves the exact original
          // note-count this path saw before the outreach gates needed a wider window.
          const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead, notes: noteTexts.slice(0, 3), contractorName, orgName, apiKey });
          finalSubject = ai.subject; finalBody = ai.body;
        } catch (e) {
          console.error(`AI draft failed for enrollment ${enrollment.id}, using plain template:`, e);
        }
      }
    }

    const { error: insertErr } = await service.from('email_logs').insert({
      lead_id: lead.id, sequence_enrollment_id: enrollment.id, sent_by: enrollment.enrolled_by,
      to_email: lead.email, subject: finalSubject, body: finalBody, status: 'draft', org_id: orgId,
    });
    if (insertErr) {
      // Don't advance — the next daily run re-picks this enrollment (intended retry).
      console.error(`email_logs insert failed for enrollment ${enrollment.id}:`, insertErr.message);
      skipped.push({ id: enrollment.id, reason: 'draft insert failed: ' + insertErr.message });
      continue;
    }
    await service.from('sequence_enrollments')
      .update(advance(enrollment.current_step, steps, new Date()))
      .eq('id', enrollment.id);
    drafted++;
    if (outreach) {
      sentTodayByOrg.set(orgId, (sentTodayByOrg.get(orgId) ?? 0) + 1);
      // outreach_sent_total tracks *drafted* outreach emails (this pipeline
      // never auto-sends — a human approval step is always required — so
      // "drafted" is the closest meaningful signal this function can
      // actually produce, matching the same loose-terminology convention
      // already used by leads_scraped_total tracking approved, not scraped).
      const ap = autopilotByOrg.get(orgId);
      if (ap) {
        ap.outreachSentTotal += 1;
        await service.from('autopilot_runs')
          .update({ outreach_sent_total: ap.outreachSentTotal }).eq('id', ap.runId);
      }
    } else {
      // Unchanged from the pre-outreach version: stay under Gemini free-tier 10 RPM.
      // Claude/outreach drafts never hit this — Anthropic's limits are far higher and
      // this task doesn't introduce a Claude-side throttle.
      await new Promise((r) => setTimeout(r, 7000));
    }
  }

  return json({ processed: (due ?? []).length, drafted, skipped }, 200, HEADERS);
});
