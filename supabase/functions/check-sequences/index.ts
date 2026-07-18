import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';
import { draftEmail } from '../_shared/ai.ts';
import { buildTemplateVars, substituteVariables } from '../_shared/templateVars.ts';

interface Step { delay_days: number; template_type: string; subject_override: string | null }

// Deno copy of advanceEnrollment from src/lib/sequenceMath.ts — keep in sync.
function advance(currentStep: number, steps: Step[], now: Date) {
  const next = currentStep + 1;
  if (next > steps.length) return { current_step: currentStep, next_send_at: null, status: 'completed' };
  return { current_step: next, next_send_at: new Date(now.getTime() + steps[next - 1]!.delay_days * 86_400_000).toISOString(), status: 'active' };
}

const HEADERS = { 'Content-Type': 'application/json' };

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

  let drafted = 0;
  const skipped: { id: string; reason: string }[] = [];

  for (const row of due ?? []) {
    const enrollment = row as Record<string, unknown> & {
      id: string; current_step: number; enrolled_by: string | null;
      sequence: { steps: Step[] } | null; lead: Record<string, unknown> | null;
    };
    const steps = enrollment.sequence?.steps ?? [];
    const step = steps[enrollment.current_step - 1];
    const lead = enrollment.lead;
    if (!step || !lead) { skipped.push({ id: enrollment.id, reason: 'missing step or lead' }); continue; }
    if (!lead.email) { skipped.push({ id: enrollment.id, reason: 'lead has no email' }); continue; }

    const { data: template } = await service
      .from('email_templates').select('*')
      .eq('template_type', step.template_type).eq('is_default', true)
      .limit(1).maybeSingle();
    if (!template) { skipped.push({ id: enrollment.id, reason: `no default template ${step.template_type}` }); continue; }

    const { data: enroller } = await service
      .from('profiles').select('full_name, email').eq('id', enrollment.enrolled_by ?? '').maybeSingle();
    const contractorName = (enroller?.full_name ?? enroller?.email ?? 'The Dreamlabs team').split(' ')[0]!;
    const { data: notes } = await service
      .from('lead_notes').select('content').eq('lead_id', lead.id as string)
      .order('created_at', { ascending: false }).limit(3);
    const noteTexts = (notes ?? []).map((n) => (n as { content: string }).content);

    const vars = buildTemplateVars(lead, contractorName, noteTexts);
    const subject = substituteVariables((step.subject_override ?? template.subject) as string, vars);
    const bodyText = substituteVariables(template.body as string, vars);

    let finalSubject = subject.text;
    let finalBody = bodyText.text;
    try {
      const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead, notes: noteTexts, contractorName });
      finalSubject = ai.subject; finalBody = ai.body;
    } catch (e) {
      console.error(`AI draft failed for enrollment ${enrollment.id}, using plain template:`, e);
    }

    await service.from('email_logs').insert({
      lead_id: lead.id, sequence_enrollment_id: enrollment.id, sent_by: enrollment.enrolled_by,
      to_email: lead.email, subject: finalSubject, body: finalBody, status: 'draft',
    });
    await service.from('sequence_enrollments')
      .update(advance(enrollment.current_step, steps, new Date()))
      .eq('id', enrollment.id);
    drafted++;
    await new Promise((r) => setTimeout(r, 7000)); // stay under Gemini free-tier 10 RPM
  }

  return json({ processed: (due ?? []).length, drafted, skipped }, 200, HEADERS);
});
