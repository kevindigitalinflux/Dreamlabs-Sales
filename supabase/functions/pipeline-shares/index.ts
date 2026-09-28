import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendMail } from '../_shared/smtp.ts';

const APP_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? 'http://localhost:5173').split(',');

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}
function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Best-effort "a pipeline was shared with you" email, sent via the SHARER's
 * own configured SMTP (there's no system-level mailer in this app — reusing
 * the sharer's mailbox mirrors how outreach emails already work). Silently
 * does nothing if the sharer hasn't set up/verified email sending — this
 * must never block or fail the share itself, which has already succeeded
 * by the time this runs.
 */
async function notifyShare(
  service: SupabaseClient,
  sharerId: string,
  recipientEmail: string,
  recipientName: string | null,
  pipelineName: string,
): Promise<void> {
  try {
    const { data: settings } = await service
      .from('user_email_settings').select('*').eq('user_id', sharerId).maybeSingle();
    if (!settings?.is_verified) return;
    const { data: pass } = await service.rpc('app_get_smtp_secret', { uid: sharerId });
    if (!pass) return;
    const appUrl = APP_ORIGINS.find((o) => o.startsWith('https://')) ?? APP_ORIGINS[0];
    const greeting = recipientName ? `Hi ${recipientName},` : 'Hi,';
    await sendMail(
      { host: settings.smtp_host, port: settings.smtp_port, user: settings.smtp_user, pass: pass as string, fromName: settings.from_name },
      {
        to: recipientEmail,
        subject: `A pipeline was shared with you: ${pipelineName}`,
        body: `${greeting}\n\n${settings.from_name ?? 'Someone'} shared the "${pipelineName}" pipeline with you on Dreamlabs Sales.\n\nSign in to see it: ${appUrl}/pipeline/manage\n`,
      },
    );
  } catch (e) {
    console.error('Failed to send pipeline-share notification email:', e);
  }
}

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
  const caller = userData?.user;
  if (!caller) return json({ error: 'Not signed in' }, 401, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers);
  }
  if (typeof body !== 'object' || body === null) return json({ error: 'Invalid JSON body' }, 400, headers);

  if (body.action === 'notify_within_org_share') {
    // The share row itself is already written client-side (RLS-gated insert/
    // upsert on pipeline_shares, which requires can_edit_pipeline) — this
    // action only sends the best-effort notification email, so it re-checks
    // that a matching share row genuinely exists and was created BY this
    // caller before sending anything, rather than trusting the client blindly.
    const pipelineId = String(body.pipeline_id ?? '');
    const recipientId = String(body.shared_with_user_id ?? '');
    if (!pipelineId || !recipientId) return json({ error: 'pipeline_id and shared_with_user_id are required' }, 400, headers);

    const { data: share } = await service
      .from('pipeline_shares').select('id')
      .eq('pipeline_id', pipelineId).eq('shared_with_user_id', recipientId).eq('shared_by', caller.id)
      .maybeSingle();
    if (!share) return json({ ok: true }, 200, headers); // nothing to notify about — no error, this is fire-and-forget

    const [{ data: pipeline }, { data: recipient }] = await Promise.all([
      service.from('pipelines').select('name').eq('id', pipelineId).maybeSingle(),
      service.from('profiles').select('email, full_name').eq('id', recipientId).maybeSingle(),
    ]);
    if (pipeline && recipient) {
      await notifyShare(service, caller.id, recipient.email, recipient.full_name, pipeline.name);
    }
    return json({ ok: true }, 200, headers);
  }

  if (body.action !== 'share_cross_org') return json({ error: 'Unknown action' }, 400, headers);

  const pipelineId = String(body.pipeline_id ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  const permission = String(body.permission ?? '');
  if (!pipelineId) return json({ error: 'pipeline_id is required' }, 400, headers);
  if (!email) return json({ error: 'email is required' }, 400, headers);
  if (permission !== 'view' && permission !== 'edit') return json({ error: 'Invalid permission' }, 400, headers);

  const { data: pipeline } = await service.from('pipelines').select('id, name, org_id, is_default').eq('id', pipelineId).maybeSingle();
  if (!pipeline) return json({ error: 'Pipeline not found' }, 404, headers);
  if (pipeline.is_default) return json({ error: 'The default pipeline cannot be shared outside the org' }, 400, headers);

  const { data: callerMembership } = await service
    .from('org_members').select('role').eq('org_id', pipeline.org_id).eq('user_id', caller.id).maybeSingle();
  const callerIsAdmin = callerMembership?.role === 'admin';
  if (!callerIsAdmin) {
    return json({ error: 'Cross-org sharing requires an org admin' }, 403, headers);
  }

  const { data: targetProfile } = await service.from('profiles').select('id, full_name').eq('email', email).maybeSingle();
  // Deliberately generic — never confirms whether a non-admin email exists at all.
  const notFoundError = { error: 'No matching admin found for that email' };
  if (!targetProfile) return json(notFoundError, 404, headers);

  const { data: targetIsAdminAnywhere } = await service
    .from('org_members').select('org_id').eq('user_id', targetProfile.id).eq('role', 'admin').limit(1);
  if (!targetIsAdminAnywhere || targetIsAdminAnywhere.length === 0) return json(notFoundError, 404, headers);

  const { error: shareErr } = await service.from('pipeline_shares').upsert({
    pipeline_id: pipelineId, shared_with_user_id: targetProfile.id, permission, shared_by: caller.id,
  }, { onConflict: 'pipeline_id,shared_with_user_id' });
  if (shareErr) {
    console.error('Failed to share pipeline cross-org:', shareErr);
    return json({ error: 'Could not share this pipeline. Please try again.' }, 500, headers);
  }
  await notifyShare(service, caller.id, email, targetProfile.full_name, pipeline.name);
  return json({ ok: true }, 200, headers);
});
