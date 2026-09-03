import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { sendMail } from '../_shared/smtp.ts';

const IMAP_PRESETS: Record<string, { host: string; port: number }> = {
  gmail: { host: 'imap.gmail.com', port: 993 },
  outlook: { host: 'outlook.office365.com', port: 993 },
  yahoo: { host: 'imap.mail.yahoo.com', port: 993 },
};

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

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const body = (await req.json()) as Record<string, unknown>;

  if (body.action === 'get') {
    const { data } = await service
      .from('user_email_settings').select('*').eq('user_id', user.id).maybeSingle();
    return json({ settings: data }, 200, headers);
  }

  if (body.action === 'save') {
    const provider = String(body.provider ?? 'gmail');
    const smtpHost = String(body.smtp_host ?? '');
    const smtpPort = Number(body.smtp_port ?? 587);
    const smtpUser = String(body.smtp_user ?? '');
    const fromName = body.from_name ? String(body.from_name) : null;
    const password = body.password ? String(body.password) : null;
    if (!smtpHost || !smtpUser) return json({ error: 'smtp_host and smtp_user are required' }, 400, headers);

    const preset = IMAP_PRESETS[provider];
    const imapHost = preset ? preset.host : (body.imap_host ? String(body.imap_host) : null);
    const imapPort = preset ? preset.port : (body.imap_port ? Number(body.imap_port) : null);

    const { error: upsertErr } = await service.from('user_email_settings').upsert(
      { user_id: user.id, provider, smtp_host: smtpHost, smtp_port: smtpPort, smtp_user: smtpUser, from_name: fromName, imap_host: imapHost, imap_port: imapPort, is_verified: false, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    if (upsertErr) return json({ error: upsertErr.message }, 400, headers);

    if (password) {
      const { error: vaultErr } = await service.rpc('app_set_smtp_secret', { uid: user.id, secret: password });
      if (vaultErr) return json({ error: 'Could not store password: ' + vaultErr.message }, 500, headers);
    }
    return json({ ok: true }, 200, headers);
  }

  if (body.action === 'test') {
    const { data: settings } = await service
      .from('user_email_settings').select('*').eq('user_id', user.id).maybeSingle();
    if (!settings) return json({ error: 'Save your email settings first' }, 400, headers);
    const { data: pass } = await service.rpc('app_get_smtp_secret', { uid: user.id });
    if (!pass) return json({ error: 'No password stored — re-save your settings including the password' }, 400, headers);
    try {
      await sendMail(
        { host: settings.smtp_host, port: settings.smtp_port, user: settings.smtp_user, pass: pass as string, fromName: settings.from_name },
        { to: user.email!, subject: 'Dreamlabs Sales — test email', body: 'Your email settings work. Happy selling!\n\n— Dreamlabs Sales' },
      );
    } catch (e) {
      return json({ error: 'Send failed: ' + (e instanceof Error ? e.message : String(e)) }, 400, headers);
    }
    await service.from('user_email_settings').update({ is_verified: true }).eq('user_id', user.id);
    return json({ ok: true }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
