import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { loadSenderMailbox, sendLeadEmail } from '../_shared/sendLeadEmail.ts';
import { applyPostSendUpdates, type PostSendResult } from '../_shared/postSendUpdates.ts';

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

  const body = (await req.json()) as { to_email?: string; subject?: string; body?: string; lead_id?: string; log_id?: string; decision_maker_candidate_id?: string; attachments?: unknown; template_id?: string };
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
    const { data: log } = await service.from('email_logs').select('sent_by, org_id, attachments, status').eq('id', body.log_id).single();
    if (!log) return json({ error: 'Draft not found' }, 404, headers);
    draft = { org_id: log.org_id as string | null, attachments: log.attachments };
    if (log.sent_by !== null && log.sent_by !== user.id) {
      return json({ error: 'Draft not found' }, 404, headers);
    }
    if (log.sent_by === null) {
      const { data: membership } = await service.from('org_members').select('role').eq('org_id', log.org_id).eq('user_id', user.id).maybeSingle();
      if (!membership) return json({ error: 'Draft not found' }, 404, headers);
    }
    // Defence in depth: an already sent email is never sent again (no screen re-sends a sent log; queues only list draft and failed).
    if (log.status === 'sent') return json({ error: 'This email was already sent' }, 400, headers);
  }

  // Optional: which template this new email came from. Stored only if it is a template of the lead's org or a global one.
  let templateId: string | undefined;
  if (body.template_id && !body.log_id && orgId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.template_id)) {
    const { data: tpl } = await service.from('email_templates').select('id').eq('id', body.template_id).or(`org_id.eq.${orgId},org_id.is.null`).maybeSingle();
    if (tpl) templateId = body.template_id;
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
    templateId,
    mailbox,
    orgId,
    leadStage,
    draft,
  });
  if (!result.ok) {
    const warning = result.warning;
    return json({ error: result.error, ...(result.logId !== undefined ? { log_id: result.logId } : {}), ...(warning ? { warning } : {}) }, result.status ?? 400, headers);
  }
  // Post-send platform updates (note, sequence, follow-up date): additive, never fails or delays the response.
  let postSend: { lines: string[]; warnings: string[] } | undefined;
  if (result.logId) {
    const logId = result.logId;
    let timer: number | undefined;
    try {
      const work = (async (): Promise<PostSendResult | null> => {
        const { data: row } = await service.from('email_logs').select('lead_id, org_id, subject, to_email, status').eq('id', logId).maybeSingle();
        const r = row as { lead_id: string | null; org_id: string | null; subject: string; to_email: string; status: string } | null;
        if (!r || r.status !== 'sent' || !r.lead_id || !r.org_id) return null;
        return applyPostSendUpdates(service, {
          orgId: r.org_id, leadId: r.lead_id, logId, userId: user.id, subject: r.subject, toEmail: r.to_email,
          recipientLabel: r.to_email, templateId: templateId ?? null,
        });
      })();
      const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), 8000); });
      const outcome = await Promise.race([work, timeout]);
      if (outcome === 'timeout') postSend = { lines: [], warnings: ['Follow-up updates took too long and may be incomplete'] };
      else if (outcome) postSend = { lines: outcome.lines, warnings: outcome.warnings };
    } catch {
      postSend = { lines: [], warnings: ['Follow-up updates could not be completed'] };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return json({ ok: true, log_id: result.logId, ...(result.warning ? { warning: result.warning } : {}), ...(postSend ? { post_send: postSend } : {}) }, 200, headers);
});
