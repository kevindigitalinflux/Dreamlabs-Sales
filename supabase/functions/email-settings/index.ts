import { createClient } from 'npm:@supabase/supabase-js@2';
import {loadTierMetrics} from '../_shared/tierMetrics.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import { sendMail } from '../_shared/smtp.ts';
import { testMailboxConnection } from '../_shared/mailboxTest.ts';
import { makeReplyInbox, parseReplyMime } from '../_shared/replyImap.ts';
import { backfillBounceOutcomes } from '../_shared/emailOutcomeBackfill.ts';

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
  if(body.action==='tier_metrics'){
    if(typeof body.org_id!=='string')return json({error:'Organisation required'},400,headers);
    const member=await service.from('org_members').select('org_id').eq('org_id',body.org_id).eq('user_id',user.id).maybeSingle();
    if(member.error||!member.data)return json({error:'Organisation not found'},404,headers);
    try{return json(await loadTierMetrics(service,body.org_id),200,headers);}
    catch{console.error('Tier metrics unavailable');return json({error:'Could not load complete tier safety rates'},503,headers);}
  }

  if (body.action === 'get') {
    const { data } = await service
      .from('user_email_settings').select('*').eq('user_id', user.id).maybeSingle();
    return json({ settings: data }, 200, headers);
  }

  if(body.action==='backfill_bounces') {
    const cursor=body.before_uid;
    if(cursor!==undefined&&(typeof cursor!=='number'||!Number.isSafeInteger(cursor)||cursor<1))return json({error:'Invalid backfill cursor'},400,headers);
    const {data:settings,error}=await service.from('user_email_settings').select('imap_host,imap_port,smtp_user,is_verified').eq('user_id',user.id).maybeSingle();
    if(error||!settings?.is_verified||!settings.imap_host||!settings.imap_port||!settings.smtp_user)return json({error:'Connect and verify your inbox first'},400,headers);
    const {data:pass,error:passError}=await service.rpc('app_get_smtp_secret',{uid:user.id});
    if(passError||!pass)return json({error:'Inbox password unavailable'},503,headers);
    try {
      const counts=await backfillBounceOutcomes(service,user.id,makeReplyInbox(settings.imap_host,settings.imap_port,settings.smtp_user,String(pass)),parseReplyMime,Date.now()+100000,new Date(),cursor as number|undefined);
      return json(counts,200,headers);
    } catch {console.error('bounce backfill: action failed');return json({error:'Bounce backfill could not finish. It is safe to retry.'},503,headers);}
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
    const { data: before, error: beforeError } = await service.from('user_email_settings').select('imap_host,smtp_user').eq('user_id', user.id).maybeSingle();
    if (beforeError) return json({ error: 'Could not check saved inbox settings' }, 503, headers);
    const mailboxChanged = before?.imap_host !== imapHost || before?.smtp_user !== smtpUser;

    const { error: upsertErr } = await service.from('user_email_settings').upsert(
      { user_id: user.id, provider, smtp_host: smtpHost, smtp_port: smtpPort, smtp_user: smtpUser, from_name: fromName, imap_host: imapHost, imap_port: imapPort, is_verified: false, updated_at: new Date().toISOString(),
        last_imap_ok_at: null, last_imap_error: null, last_imap_error_at: null, ...(mailboxChanged ? { last_imap_check_uid: null } : {}) },
      { onConflict: 'user_id' },
    );
    if (upsertErr) return json({ error: 'Could not save your email settings' }, 400, headers);

    if (password) {
      const { error: vaultErr } = await service.rpc('app_set_smtp_secret', { uid: user.id, secret: password });
      if (vaultErr) return json({ error: 'Could not store the password. Please try again.' }, 500, headers);
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
      console.error('email settings: send test failed');
      return json({ error: 'Test email could not be sent. Check your password and sending settings.' }, 400, headers);
    }
    await service.from('user_email_settings').update({ is_verified: true }).eq('user_id', user.id);
    return json({ ok: true }, 200, headers);
  }

  if (body.action === 'test_imap') {
    const result = await testMailboxConnection(service, user.id, makeReplyInbox);
    return json(result, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
