import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { sendMail } from '../_shared/smtp.ts';

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

  const body = (await req.json()) as { to_email?: string; subject?: string; body?: string; lead_id?: string; log_id?: string };
  if (!body.to_email || !body.subject || !body.body) {
    return json({ error: 'to_email, subject and body are required' }, 400, headers);
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: settings } = await service
    .from('user_email_settings').select('*').eq('user_id', user.id).maybeSingle();
  if (!settings?.is_verified) return json({ error: 'Set up and verify your email in Settings → Email sending first' }, 400, headers);
  const { data: pass } = await service.rpc('app_get_smtp_secret', { uid: user.id });
  if (!pass) return json({ error: 'No stored email password — re-save your settings' }, 400, headers);

  // If updating an existing draft, make sure it belongs to the caller.
  if (body.log_id) {
    const { data: log } = await service.from('email_logs').select('sent_by').eq('id', body.log_id).single();
    if (!log || log.sent_by !== user.id) return json({ error: 'Draft not found' }, 404, headers);
  }

  let status = 'sent';
  let errorMessage: string | null = null;
  try {
    await sendMail(
      { host: settings.smtp_host, port: settings.smtp_port, user: settings.smtp_user, pass: pass as string, fromName: settings.from_name },
      { to: body.to_email, subject: body.subject, body: body.body },
    );
  } catch (e) {
    status = 'failed';
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  const row = {
    lead_id: body.lead_id ?? null, sent_by: user.id, to_email: body.to_email,
    subject: body.subject, body: body.body, status, error_message: errorMessage,
    sent_at: new Date().toISOString(),
  };
  let logId = body.log_id ?? null;
  if (logId) {
    await service.from('email_logs').update(row).eq('id', logId);
  } else {
    const { data: inserted } = await service.from('email_logs').insert(row).select('id').single();
    logId = (inserted as { id: string } | null)?.id ?? null;
  }

  if (status === 'failed') return json({ error: 'Send failed: ' + errorMessage, log_id: logId }, 400, headers);
  return json({ ok: true, log_id: logId }, 200, headers);
});
