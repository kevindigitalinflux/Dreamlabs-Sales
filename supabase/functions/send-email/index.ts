import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { loadSenderMailbox, sendLeadEmail } from '../_shared/sendLeadEmail.ts';

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await anonClient.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'Not signed in' }, 401, headers);

  const body = (await req.json()) as { to_email?: string; subject?: string; body?: string; lead_id?: string; log_id?: string; decision_maker_candidate_id?: string; attachments?: unknown };
  if (!body.to_email || !body.subject || !body.body) {
    return json({ error: 'to_email, subject and body are required' }, 400, headers);
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const mailbox = await loadSenderMailbox(service, user.id);
  if (!mailbox.ok) return json({ error: mailbox.error }, mailbox.status, headers);

  let orgId: string | null = null;
  let leadStage: string | null = null;
  if (body.lead_id) {
    const { data: lead } = await service.from('leads').select('org_id, stage').eq('id', body.lead_id).maybeSingle();
    orgId = (lead as { org_id: string; stage: string } | null)?.org_id ?? null;
    leadStage = (lead as { org_id: string; stage: string } | null)?.stage ?? null;
  }
  if (!orgId && !body.log_id) return json({ error: 'lead_id is required to send a new email' }, 400, headers);
  // The caller supplies lead_id directly, and we later write to that lead
  // (last_contacted_at / stage) — so confirm they are actually a member of the
  // lead's org before trusting it. 404 rather than 403: don't confirm the
  // lead's existence to a non-member.
  if (orgId) {
    const { data: membership } = await service.from('org_members').select('role').eq('org_id', orgId).eq('user_id', user.id).maybeSingle();
    if (!membership) return json({ error: 'Lead not found' }, 404, headers);
  }

  // If updating an existing draft, make sure it belongs to the caller — except
  // for system-generated drafts (sent_by = null, e.g. autopilot's auto-enrolled
  // outreach and check-replies' auto-drafted responses, both of which have no
  // individual owner by design), which any member of the draft's own org may
  // claim and send. A human-created draft (sent_by set) is still strictly
  // owner-only.
  let draft: { org_id: string | null; attachments: unknown } | undefined;
  if (body.log_id) {
    const { data: log } = await service.from('email_logs').select('sent_by, org_id, attachments').eq('id', body.log_id).single();
    if (!log) return json({ error: 'Draft not found' }, 404, headers);
    draft = { org_id: log.org_id as string | null, attachments: log.attachments };
    if (log.sent_by !== null && log.sent_by !== user.id) {
      return json({ error: 'Draft not found' }, 404, headers);
    }
    if (log.sent_by === null) {
      const { data: membership } = await service.from('org_members').select('role').eq('org_id', log.org_id).eq('user_id', user.id).maybeSingle();
      if (!membership) return json({ error: 'Draft not found' }, 404, headers);
    }
  }

  const result = await sendLeadEmail(service, {
    senderId: user.id,
    to: body.to_email,
    subject: body.subject,
    body: body.body,
    leadId: body.lead_id,
    logId: body.log_id,
    decisionMakerCandidateId: body.decision_maker_candidate_id,
    attachments: body.attachments,
    mailbox,
    orgId,
    leadStage,
    draft,
  });
  if (!result.ok) {
    const warning = result.warning;
    return json({ error: result.error, ...(result.logId !== undefined ? { log_id: result.logId } : {}), ...(warning ? { warning } : {}) }, result.status ?? 400, headers);
  }
  return json({ ok: true, log_id: result.logId, ...(result.warning ? { warning: result.warning } : {}) }, 200, headers);
});
