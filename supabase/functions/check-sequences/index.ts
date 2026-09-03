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
  const autopilotByOrg = new Map<string, { dailyOutreachTarget: number; dayNumber: number; rampUp: boolean; maxSpendCents: number | null; actualSpendCents: number; runId: string } | null>();
  const sentTodayByOrg = new Map<string, number>();

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
          .select('id, daily_outreach_target, ramp_up_enabled, started_at, max_total_spend_cents, actual_ai_cost_cents')
          .eq('org_id', orgId).eq('status', 'active').maybeSingle();
        if (run) {
          const dayNumber = Math.max(1, Math.floor((Date.now() - new Date(run.started_at).getTime()) / 86_400_000) + 1);
          autopilotByOrg.set(orgId, {
            dailyOutreachTarget: run.daily_outreach_target, dayNumber, rampUp: run.ramp_up_enabled,
            maxSpendCents: run.max_total_spend_cents, actualSpendCents: run.actual_ai_cost_cents, runId: run.id,
          });
        } else {
          autopilotByOrg.set(orgId, null);
        }
      }
      const autopilot = autopilotByOrg.get(orgId);
      if (autopilot) {
        if (autopilot.maxSpendCents != null && autopilot.actualSpendCents >= autopilot.maxSpendCents) {
          skipped.push({ id: enrollment.id, reason: 'autopilot spend cap reached' });
          continue;
        }
        const cap = autopilot.rampUp ? rampedCap(autopilot.dailyOutreachTarget, autopilot.dayNumber) : autopilot.dailyOutreachTarget;
        if (!sentTodayByOrg.has(orgId)) {
          const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
          const { count } = await service.from('email_logs')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', orgId).gte('sent_at', startOfDay.toISOString());
          sentTodayByOrg.set(orgId, count ?? 0);
        }
        const sentToday = sentTodayByOrg.get(orgId)!;
        if (sentToday >= cap) { skipped.push({ id: enrollment.id, reason: 'autopilot daily cap reached' }); continue; }
      }
    }

    const { data: template } = await service
      .from('email_templates').select('*')
      .eq('template_type', step.template_type).eq('is_default', true)
      .limit(1).maybeSingle();
    if (!template) { skipped.push({ id: enrollment.id, reason: `no default template ${step.template_type}` }); continue; }

    const { data: enroller } = await service
      .from('profiles').select('full_name, email').eq('id', enrollment.enrolled_by ?? '').maybeSingle();
    const contractorName = (enroller?.full_name ?? enroller?.email ?? 'The Dreamlabs team').split(' ')[0]!;
    const { data: notesRows } = await service
      .from('lead_notes').select('content, note_type').eq('lead_id', lead.id as string)
      .order('created_at', { ascending: false }).limit(5);
    const noteTexts = (notesRows ?? []).map((n) => (n as { content: string }).content);
    const hasHumanNote = (notesRows ?? []).some((n) => (n as { note_type: string }).note_type !== 'ai_summary');
    const hasAiSummary = (notesRows ?? []).some((n) => (n as { note_type: string }).note_type === 'ai_summary');

    const vars = buildTemplateVars(lead, contractorName, noteTexts);
    const subject = substituteVariables((step.subject_override ?? template.subject) as string, vars);
    const bodyText = substituteVariables(template.body as string, vars);

    let finalSubject = subject.text;
    let finalBody = bodyText.text;

    if (outreach) {
      const apiKey = await resolveOrgApiKey(service, orgId, 'anthropic');
      if (!apiKey) { skipped.push({ id: enrollment.id, reason: 'no anthropic key configured' }); continue; }

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
        if (autopilotByOrg.get(orgId)) {
          const costCents = 1; // rough per-draft accounting, see run-autopilot's estimate math
          await service.from('autopilot_runs').update({ actual_ai_cost_cents: (autopilotByOrg.get(orgId)!.actualSpendCents + costCents) }).eq('org_id', orgId).eq('status', 'active');
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
          const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead, notes: noteTexts, contractorName, orgName, apiKey });
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
    } else {
      // Unchanged from the pre-outreach version: stay under Gemini free-tier 10 RPM.
      // Claude/outreach drafts never hit this — Anthropic's limits are far higher and
      // this task doesn't introduce a Claude-side throttle.
      await new Promise((r) => setTimeout(r, 7000));
    }
  }

  return json({ processed: (due ?? []).length, drafted, skipped }, 200, HEADERS);
});
