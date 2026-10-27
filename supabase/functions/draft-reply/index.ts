import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { loadVisibleReply } from '../_shared/replyAccess.ts';
import { composeReply } from '../_shared/replyDraft.ts';

/** Explicit user-requested draft only. Never writes email_logs or sends mail. */
Deno.serve(async req => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);
  try {
    const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data } = await caller.auth.getUser();
    if (!data.user) return json({ error: 'Not signed in' }, 401, headers);
    const body = await req.json() as { reply_id?: string };
    if (typeof body.reply_id !== 'string') return json({ error: 'Choose a reply first' }, 400, headers);
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const visible = await loadVisibleReply(service, caller, data.user.id, body.reply_id);
    if (!visible) return json({ error: 'Reply not found' }, 404, headers);
    return json(await composeReply(service, visible.context, data.user.id), 200, headers);
  } catch {
    console.error('draft reply: draft failed');
    return json({ error: 'Could not draft an answer. Check your organisation’s AI settings and try again.' }, 503, headers);
  }
});
