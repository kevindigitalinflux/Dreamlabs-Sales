import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';
import { draftEmail, draftEmailClaude, generateLeadNotes } from '../_shared/ai.ts';
import type { ClaudeModel } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { buildTemplateVars, substituteVariables } from '../_shared/templateVars.ts';
import { appendLinks, onlyOrgAttachments, parseAttachments, parseLinks } from '../_shared/emailAttachments.ts';
import { formatIcpContext, loadIcp, resolveIcpId, topPainPoint } from '../_shared/icp.ts';
import { applyCustomVariables, loadCustomVariables } from '../_shared/customVariables.ts';
import type { Contact } from '../_shared/contacts.ts';
import { capDecision, capLimitedNoteText, isSequenceSystemNote, noRecipientsNoteText, planStepDrafts, recipientNaming, recipientsWithoutDraft, shouldAdvance } from '../_shared/sequenceRecipients.ts';

interface Step { delay_days: number; template_type: string; template_id?: string | null; subject_override: string | null }

// Deno copy of advanceEnrollment from src/lib/sequenceMath.ts — keep in sync.
function advance(currentStep: number, steps: Step[], now: Date) {
  const next = currentStep + 1;
  if (next > steps.length) return { current_step: currentStep, next_send_at: null, status: 'completed' };
  return { current_step: next, next_send_at: new Date(now.getTime() + steps[next - 1]!.delay_days * 86_400_000).toISOString(), status: 'active' };
}

/** Stop starting new enrolments after this long (the edge function wall-clock limit is higher). */
const TIME_BUDGET_MS = 110_000;
/** No NEW draft is started after this long (lower, so a draft in progress can finish); a Gemini draft also needs its 7s pause. */
const DRAFT_START_BUDGET_MS = 100_000;
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
 *
 * Recipients: each due step is drafted for everyone `sequenceRecipients` returns for the lead
 * (its live contacts in `decision_maker_candidates`), one draft per contact, each greeted by its
 * own name (a shared inbox gets "Hi there"). A lead with no contact that has an email is drafted
 * exactly as before (one draft to `lead.email`). The enrolment advances ONCE per step, and only if
 * at least one draft was created. One failing contact never stops the others; if every draft fails
 * the enrolment is not advanced (retried next run). The autopilot daily cap counts every draft.
 * When there is nobody to write to because every contact was excluded from sequences, the step is
 * NOT drafted or advanced: the enrolment is set to 'paused' (so it is not retried daily), a lead
 * note says why (once per 7 days), and the response lists it in `skipped` as 'no recipients'.
 */
Deno.serve(async (req) => {
  const startedAt = Date.now();
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
    .lte('next_send_at', new Date().toISOString())
    // Oldest first, so enrolments deferred by the time budget below are picked up first next time.
    .order('next_send_at', { ascending: true });

  // Autopilot throttle state, computed once per org as it's needed.
  const autopilotByOrg = new Map<string, { dailyOutreachTarget: number; dayNumber: number; rampUp: boolean; maxSpendCents: number | null; actualSpendCents: number; outreachSentTotal: number; runId: string } | null>();
  const sentTodayByOrg = new Map<string, number>();
  const outreachSeqIdsByOrg = new Map<string, string[]>();
  // Guards against redundant cancel writes if multiple enrollments in the
  // same org hit the spend cap within one invocation.
  const cancelledRunsThisInvocation = new Set<string>();

  let drafted = 0;
  const skipped: { id: string; reason: string }[] = [];

  const dueRows = due ?? [];
  for (let rowIdx = 0; rowIdx < dueRows.length; rowIdx++) {
    // Soft time budget: stop starting NEW enrolments after ~110s so the run ends cleanly; the rest go first next run.
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      for (const rest of dueRows.slice(rowIdx)) skipped.push({ id: (rest as { id: string }).id, reason: 'time budget' });
      break;
    }
    const row = dueRows[rowIdx]!;
    const enrollment = row as Record<string, unknown> & {
      id: string; current_step: number; enrolled_by: string | null; next_send_at: string;
      sequence: { steps: Step[]; auto_draft_on_reply: boolean; icp_id?: string | null } | null;
      lead: Record<string, unknown> | null;
    };
    const steps = enrollment.sequence?.steps ?? [];
    const step = steps[enrollment.current_step - 1];
    const lead = enrollment.lead;
    if (!step || !lead) { skipped.push({ id: enrollment.id, reason: 'missing step or lead' }); continue; }
    // The lead's live contacts decide who is written to. Fail closed: if they cannot be read, draft nothing
    // (an excluded person must never be written to by mistake); the next daily run retries.
    const { data: contactRows, error: contactsErr } = await service.from('decision_maker_candidates')
      .select('id, kind, first_name, last_name, title, label, email, phone, is_primary, include_in_sequences, dismissed_at, source')
      .eq('lead_id', lead.id as string).is('dismissed_at', null).order('created_at');
    if (contactsErr) {
      console.error(`contacts load failed for enrollment ${enrollment.id}:`, contactsErr.message);
      skipped.push({ id: enrollment.id, reason: 'contacts load failed' });
      continue;
    }
    const contacts = (contactRows ?? []) as unknown as Contact[];
    const prePlan = planStepDrafts({ contacts, leadEmail: (lead.email as string | null) ?? null, optedOut: false, capRemaining: null });
    if (prePlan.kind === 'none' && prePlan.reason === 'no_email') { skipped.push({ id: enrollment.id, reason: 'lead has no email' }); continue; }
    if (lead.opted_out) {
      skipped.push({ id: enrollment.id, reason: 'lead opted out' });
      await service.from('sequence_enrollments').update({ status: 'cancelled' }).eq('id', enrollment.id);
      continue;
    }
    if (prePlan.kind === 'none') {
      // Every contact is excluded from sequences: pause visibly instead of stalling (or retrying daily).
      skipped.push({ id: enrollment.id, reason: 'no recipients' });
      const noteText = noRecipientsNoteText();
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data: existingNote, error: existingErr } = await service.from('lead_notes').select('id')
        .eq('lead_id', lead.id as string).eq('note_type', 'general').eq('content', noteText).gte('created_at', since).limit(1);
      // Fail closed: if we cannot tell whether the note exists, do not risk a duplicate (the enrolment is still paused).
      if (existingErr) console.error(`no-recipients note check failed for enrollment ${enrollment.id}:`, existingErr.message);
      else if (!existingNote || existingNote.length === 0) {
        const { error: noteErr } = await service.from('lead_notes').insert({
          lead_id: lead.id, created_by: null, note_type: 'general', content: noteText,
        });
        if (noteErr) console.error(`no-recipients note failed for enrollment ${enrollment.id}:`, noteErr.message);
      }
      const { error: pauseErr } = await service.from('sequence_enrollments').update({ status: 'paused' }).eq('id', enrollment.id);
      if (pauseErr) console.error(`pausing enrollment ${enrollment.id} failed:`, pauseErr.message);
      continue;
    }

    const orgId = lead.org_id as string;
    const outreach = isOutreachTemplate(step.template_type);
    // Drafts this step may still create under the autopilot daily cap (null = no cap). A multi-contact step uses several.
    let capRemaining: number | null = null;
    let dailyCap: number | null = null;

    // Autopilot daily throttle — only applies to outreach templates in an org with an active run.
    if (outreach) {
      if (!autopilotByOrg.has(orgId)) {
        const { data: run } = await service.from('autopilot_runs')
          .select('id, daily_outreach_target, ramp_up_enabled, started_at, max_total_spend_cents, actual_ai_cost_cents, outreach_sent_total')
          .eq('org_id', orgId).eq('status', 'active').eq('mode', 'discover').maybeSingle();
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
        capRemaining = cap - sentToday;
        dailyCap = cap;
      }
    }

    // Org-scoped template first (the new cold_outreach_*/jv_pitch_* templates are
    // seeded per-org), falling back to the global org_id=null default that every
    // pre-existing cycle-2 template type still uses exclusively.
    // A step that names a specific template (the user's own, all of which share the generic
    // type 'custom') is looked up by id, limited to this org or the shared (org-less) set.
    // Otherwise it's one of the built-in kinds and is found by type, as before.
    let template: Record<string, unknown> | null = null;
    if (step.template_id) {
      const { data: own } = await service
        .from('email_templates').select('*').eq('id', step.template_id)
        .or(`org_id.eq.${orgId},org_id.is.null`).maybeSingle();
      template = own ?? null;
      if (!template) { skipped.push({ id: enrollment.id, reason: `template ${step.template_id} not found (deleted?)` }); continue; }
    } else {
      const { data: templates } = await service
        .from('email_templates').select('*')
        .eq('template_type', step.template_type).eq('is_default', true)
        .or(`org_id.eq.${orgId},org_id.is.null`);
      template = (templates ?? []).find((t) => (t as { org_id: string | null }).org_id === orgId)
        ?? (templates ?? []).find((t) => (t as { org_id: string | null }).org_id === null)
        ?? null;
      if (!template) { skipped.push({ id: enrollment.id, reason: `no default template ${step.template_type}` }); continue; }
    }

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
    // This feature's own system notes are not call/meeting context, so they never feed a draft.
    const noteTexts = (notesRows ?? []).map((n) => (n as { content: string }).content).filter((c) => !isSequenceSystemNote(c));

    // Customer profile: the lead's own, else the step's template's, else the sequence's. Supplies
    // {{pain_point}} when the lead has none noted, and context for the AI draft.
    const icp = await loadIcp(service, orgId, resolveIcpId(lead.icp_id as string | null, template.icp_id as string | null, enrollment.sequence?.icp_id));
    const icpContext = formatIcpContext(icp);
    // Built-ins, then the enrolling user's own placeholders and the company-wide ones (system-enrolled leads get company-wide only).
    // Placeholders are filled per recipient below; the pain point is read from the notes as they were before any AI notes pass.
    const customVars = await loadCustomVariables(service, orgId, enrollment.enrolled_by);
    const varNotes = [...noteTexts];

    // Who this step is written to (the full list; caps are applied below). A lead with no contact that has an
    // email is the old single draft to lead.email.
    const plan = planStepDrafts({ contacts, leadEmail: (lead.email as string | null) ?? null, optedOut: false, capRemaining: null });
    const multi = plan.kind === 'multi';

    // Idempotency: a draft already created for this step and address (an earlier run that stopped part-way) is
    // reused, never duplicated. A released or sent copy of THIS step's draft counts too; earlier steps' emails were
    // created before this step's due time. Needs email_logs.created_at (migration 054); without it the read fails
    // and the enrolment is skipped (fail closed).
    const { data: existingDrafts, error: existingDraftsErr } = await service.from('email_logs').select('to_email')
      .eq('sequence_enrollment_id', enrollment.id).in('status', ['draft', 'sent']).gte('created_at', enrollment.next_send_at);
    if (existingDraftsErr) {
      console.error(`existing-draft check failed for enrollment ${enrollment.id}:`, existingDraftsErr.message);
      skipped.push({ id: enrollment.id, reason: 'draft check failed' });
      continue;
    }
    const missing = recipientsWithoutDraft(plan.recipients, (existingDrafts ?? []).map((d) => String((d as { to_email: string }).to_email)));
    const alreadyCovered = plan.recipients.length - missing.length;
    // A multi-contact step never silently loses contacts to the daily cap: defer it a day if a full day could cover it.
    const decision = capDecision({ needed: missing.length, capRemaining, dailyCap });
    if (decision.action === 'defer') { skipped.push({ id: enrollment.id, reason: 'autopilot daily cap reached' }); continue; }
    const toDraft = missing.slice(0, decision.allow);
    const capTruncated = decision.action === 'truncate' && toDraft.length < missing.length;

    // Outreach steps need the notes-then-draft setup ONCE per enrolment run (never per contact); the notes are reused by every draft.
    let outreachKey: string | null = null;
    if (outreach && toDraft.length > 0) {
      const apiKey = await resolveOrgApiKey(service, orgId, 'anthropic');
      if (!apiKey) { skipped.push({ id: enrollment.id, reason: 'no anthropic key configured' }); continue; }
      outreachKey = apiKey;

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
        .eq('lead_id', lead.id as string).neq('note_type', 'ai_summary')
        .not('content', 'eq', noRecipientsNoteText()).not('content', 'like', 'Sequence follow-up limited:%');
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
          const notesText = await generateLeadNotes({ lead, icpParams, icpContext, apiKey });
          await service.from('lead_notes').insert({
            lead_id: lead.id, created_by: null, note_type: 'ai_summary', content: notesText,
          });
          noteTexts.unshift(notesText);
        } catch (e) {
          console.error(`generateLeadNotes failed for lead ${lead.id}, continuing without it:`, e);
        }
      }
    }

    // The organisation is read once per enrolment (only when an AI draft needs it).
    let orgInfo: { name?: string | null; company_context?: string | null } | null | undefined;
    const getOrg = async () => {
      if (orgInfo === undefined) {
        orgInfo = (await service.from('organizations').select('name, company_context').eq('id', orgId).maybeSingle()).data;
      }
      return orgInfo;
    };

    const model: ClaudeModel = 'claude-haiku-4-5';
    let draftsCreated = 0;
    const failures: string[] = [];
    let stoppedBySpendCap = false;
    let stoppedByTime = false;

    for (let idx = 0; idx < toDraft.length; idx++) {
      const target = toDraft[idx]!;
      // Never start a draft late in the run; the step stays partial (not advanced) and the rest is done next run.
      if (Date.now() - startedAt > DRAFT_START_BUDGET_MS - (outreach ? 0 : 7000)) { stoppedByTime = true; break; }
      // Spend cap is re-checked before every further draft of a multi-contact step.
      if (idx > 0) {
        const apNow = outreach ? autopilotByOrg.get(orgId) : null;
        if (apNow && apNow.maxSpendCents != null && apNow.actualSpendCents >= apNow.maxSpendCents) { stoppedBySpendCap = true; break; }
        // Stay under Gemini free-tier 10 RPM between this step's drafts (same pause as between enrolments).
        if (!outreach) await new Promise((r) => setTimeout(r, 7000));
      }

      // The contact being written to (none = the lead's own contact, which keeps the lead's own naming).
      const contact = multi && target.contactId ? contacts.find((c) => c.id === target.contactId) : undefined;
      const naming = contact ? recipientNaming(contact) : null;
      // A named person: their name replaces the lead's owner for the variables AND the AI. A shared inbox: no person is named.
      const leadForDraft: Record<string, unknown> = naming ? { ...lead, owner_name: naming.ownerName } : lead;
      const vars = applyCustomVariables(
        buildTemplateVars(leadForDraft, contractorName, varNotes, topPainPoint(icp), naming?.generalInbox ? { generalInbox: true } : {}),
        customVars,
      );
      const subject = substituteVariables((step.subject_override ?? template.subject) as string, vars);
      const bodyText = substituteVariables(template.body as string, vars);

      let finalSubject = subject.text;
      let finalBody = bodyText.text;

      if (outreachKey) {
        try {
          const org = await getOrg();
          const orgName = org?.name ?? 'our team';
          const recipientInput = naming
            ? (naming.generalInbox
              ? { generalInbox: true, untrustedData: true }
              : { recipient: { name: naming.ownerName, title: naming.title }, untrustedData: true })
            : {};
          const ai = await draftEmailClaude({ subject: subject.text, body: bodyText.text, lead: leadForDraft, notes: noteTexts, contractorName, orgName, companyContext: org?.company_context, icpContext, apiKey: outreachKey, model, ...recipientInput });
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
            const org = await getOrg();
            const orgName = org?.name ?? 'our team';
            // Only the first 3 (of up to 5 fetched) — preserves the exact original
            // note-count this path saw before the outreach gates needed a wider window.
            const recipientInput = naming ? { recipientTitle: naming.title, recipientName: naming.ownerName, generalInbox: naming.generalInbox } : {};
            const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead: leadForDraft, notes: noteTexts.slice(0, 3), contractorName, orgName, companyContext: org?.company_context, icpContext, apiKey, ...recipientInput });
            finalSubject = ai.subject; finalBody = ai.body;
          } catch (e) {
            console.error(`AI draft failed for enrollment ${enrollment.id}, using plain template:`, e);
          }
        }
      }

      const { error: insertErr } = await service.from('email_logs').insert({
        lead_id: lead.id, sequence_enrollment_id: enrollment.id, sent_by: enrollment.enrolled_by,
        // The template's links go at the end AFTER any AI rewrite (so a URL can't be altered), and its
        // files are carried on the draft so the human release step sends them too.
        to_email: multi ? target.email : lead.email, subject: finalSubject, body: appendLinks(finalBody, parseLinks(template.links)), status: 'draft', org_id: orgId,
        attachments: onlyOrgAttachments(parseAttachments(template.attachments), orgId),
        // Only per-contact drafts record who they were written to (null = the lead's own email).
        ...(multi ? { decision_maker_candidate_id: target.contactId } : {}),
      });
      if (insertErr) {
        // One contact failing never stops the others.
        console.error(`email_logs insert failed for enrollment ${enrollment.id}:`, insertErr.message);
        failures.push(multi ? `draft insert failed for ${target.contactId ?? 'lead email'}: ${insertErr.message}` : 'draft insert failed: ' + insertErr.message);
        continue;
      }
      draftsCreated++;
    }

    // Advance exactly once, and only when a draft exists for EVERY planned recipient (created now or found from an
    // earlier partial run). A partial result (insert failure, spend cap) never advances: the next run makes the rest.
    const planned = alreadyCovered + toDraft.length;
    const covered = alreadyCovered + draftsCreated;
    const advanceOk = shouldAdvance({ planned, covered });
    if (advanceOk) {
      await service.from('sequence_enrollments')
        .update(advance(enrollment.current_step, steps, new Date()))
        .eq('id', enrollment.id);
      if (capTruncated) {
        // Even a full day's cap is too small for this lead's contacts: say so on the lead.
        const { error: capNoteErr } = await service.from('lead_notes').insert({
          lead_id: lead.id, created_by: null, note_type: 'general', content: capLimitedNoteText(enrollment.current_step, covered, plan.recipients.length),
        });
        if (capNoteErr) console.error(`cap note failed for enrollment ${enrollment.id}:`, capNoteErr.message);
        skipped.push({ id: enrollment.id, reason: `daily cap too small: ${covered} of ${plan.recipients.length} contacts drafted, step advanced` });
      }
    } else {
      // Don't advance — the next daily run re-picks this enrollment and creates only the missing drafts (intended retry).
      const why = [...failures, ...(stoppedBySpendCap ? ['autopilot spend cap reached'] : []), ...(stoppedByTime ? ['time budget'] : [])].join('; ');
      skipped.push({ id: enrollment.id, reason: !multi ? why : (covered === alreadyCovered && alreadyCovered === 0 && failures.length > 0 ? `all ${planned} drafts failed: ${why}` : `incomplete: ${covered} of ${planned} drafts exist, step not advanced; ${why}`) });
    }
    drafted += draftsCreated;
    if (draftsCreated > 0) {
    if (outreach) {
      sentTodayByOrg.set(orgId, (sentTodayByOrg.get(orgId) ?? 0) + draftsCreated);
      // outreach_sent_total tracks *drafted* outreach emails (this pipeline
      // never auto-sends — a human approval step is always required — so
      // "drafted" is the closest meaningful signal this function can
      // actually produce, matching the same loose-terminology convention
      // already used by leads_scraped_total tracking approved, not scraped).
      const ap = autopilotByOrg.get(orgId);
      if (ap) {
        ap.outreachSentTotal += draftsCreated;
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
  }

  return json({ processed: (due ?? []).length, drafted, skipped }, 200, HEADERS);
});
