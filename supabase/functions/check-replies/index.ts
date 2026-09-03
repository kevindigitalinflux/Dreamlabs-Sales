import { createClient } from 'npm:@supabase/supabase-js@2';
import { ImapFlow } from 'npm:imapflow@1';
import { json } from '../_shared/cors.ts';
import { classifyReply, draftEmailClaude } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';

const HEADERS = { 'Content-Type': 'application/json' };
const BOUNCE_PATTERN = /mailer-daemon|postmaster/i;
const BOUNCE_SUBJECT_PATTERN = /undeliverable|delivery status notification|failure notice/i;

interface VerifiedUser {
  user_id: string; imap_host: string | null; imap_port: number | null;
  smtp_user: string | null; last_imap_check_at: string | null;
  last_imap_check_uid: number | null;
}

/**
 * Cron target: polls each verified user's own mailbox via IMAP, matches
 * replies to sent emails via In-Reply-To/References headers against a stored
 * Message-ID, pauses the matched enrollment, records the reply, and
 * optionally auto-drafts a suggested response (Haiku classifies simple vs.
 * complex first, escalating to Sonnet only for complex replies). Also flags
 * bounce-pattern messages toward any active autopilot run's bounce counter.
 * Same shared-secret auth as check-sequences.
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

  const { data: users } = await service
    .from('user_email_settings')
    .select('user_id, imap_host, imap_port, smtp_user, last_imap_check_at, last_imap_check_uid')
    .eq('is_verified', true).not('imap_host', 'is', null);

  let matched = 0; let bounces = 0;
  const errors: { user_id: string; error: string }[] = [];

  for (const u of (users ?? []) as VerifiedUser[]) {
    if (!u.imap_host || !u.imap_port || !u.smtp_user) continue;
    const { data: pass } = await service.rpc('app_get_smtp_secret', { uid: u.user_id });
    if (!pass) continue;

    // Resolved once per mailbox, not per message: the real contractor name
    // for drafted sign-offs (replaces a hardcoded 'there' placeholder), and
    // this mailbox owner's org, used to scope which autopilot run a bounce
    // seen in their inbox is allowed to charge. A user with no org
    // membership just can't have bounces attributed anywhere (skipped
    // below, never crashes the run).
    const { data: profile } = await service.from('profiles').select('full_name, email').eq('id', u.user_id).maybeSingle();
    const contractorName = (profile?.full_name ?? profile?.email ?? 'The Dreamlabs team').split(' ')[0]!;
    const { data: membership } = await service.from('org_members').select('org_id').eq('user_id', u.user_id).limit(1).maybeSingle();
    const userOrgId = membership?.org_id ?? null;

    // Constructing ImapFlow itself does no I/O, but keeping it inside the
    // try (rather than before it, as first drafted) means a bad per-user
    // config can't throw past the per-user error boundary and abort every
    // remaining mailbox in this run.
    let client: ImapFlow | undefined;
    try {
      client = new ImapFlow({
        host: u.imap_host, port: u.imap_port, secure: true,
        auth: { user: u.smtp_user, pass: pass as string }, logger: false,
      });

      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      // IMAP's SINCE search key (and imapflow's own formatDate()) is date-only —
      // the time component is discarded server-side — so `since` below is only
      // ever a coarse net that can re-match messages already handled on a prior
      // run within the same day. `highestUid` tracks the real dedup watermark:
      // every UID seen this scan is skipped if it's <= the last persisted
      // watermark, and the new high-water mark is persisted at the end
      // regardless of whether anything matched, so the next run's net only
      // needs to cover truly-new messages.
      let highestUid = u.last_imap_check_uid ?? 0;
      try {
        const since = u.last_imap_check_at ? new Date(u.last_imap_check_at) : new Date(Date.now() - 24 * 60 * 60 * 1000);
        for await (const msg of client.fetch({ since }, { envelope: true, source: { maxLength: 20000 } })) {
          if (msg.uid > highestUid) highestUid = msg.uid;
          if (u.last_imap_check_uid != null && msg.uid <= u.last_imap_check_uid) continue; // already processed on a prior run

          const inReplyTo = msg.envelope?.inReplyTo ?? null;
          const fromAddr = msg.envelope?.from?.[0]?.address ?? '';
          const subject = msg.envelope?.subject ?? '';

          if (BOUNCE_PATTERN.test(fromAddr) || BOUNCE_SUBJECT_PATTERN.test(subject)) {
            if (userOrgId) {
              const { data: activeRun } = await service.from('autopilot_runs')
                .select('id, bounce_count').eq('status', 'active').eq('org_id', userOrgId).maybeSingle();
              if (activeRun) {
                await service.from('autopilot_runs').update({ bounce_count: activeRun.bounce_count + 1 }).eq('id', activeRun.id);
                bounces++;
                const { data: run } = await service.from('autopilot_runs').select('bounce_count').eq('id', activeRun.id).single();
                if (run && run.bounce_count >= 10) {
                  await service.from('autopilot_runs').update({ status: 'cancelled', cancel_reason: 'bounce threshold reached' }).eq('id', activeRun.id);
                }
              }
            }
            continue;
          }

          if (!inReplyTo) continue;
          // Scoped to this mailbox's own sends: In-Reply-To is an unauthenticated
          // header anyone can forge, so without this a message crafted to
          // reference some OTHER org's real Message-ID could pause that org's
          // enrollment and spend that org's Anthropic key from this mailbox.
          const { data: sentLog } = await service.from('email_logs')
            .select('id, lead_id, sequence_enrollment_id, org_id')
            .eq('message_id', inReplyTo).eq('status', 'sent').eq('sent_by', u.user_id).maybeSingle();
          if (!sentLog || !sentLog.sequence_enrollment_id || !sentLog.lead_id) continue;

          // Second half of the forgery guard: even with a real Message-ID match,
          // require the reply's actual From address to match the lead it claims
          // to be replying on behalf of before acting on it at all. A forged
          // In-Reply-To against this mailbox's own genuine Message-IDs (e.g. a
          // reused/leaked one) still can't hijack a real lead's thread this way.
          const { data: lead } = await service.from('leads').select('*').eq('id', sentLog.lead_id).single();
          if (!lead?.email || lead.email.toLowerCase() !== fromAddr.toLowerCase()) continue;

          const bodyText = msg.source ? new TextDecoder().decode(msg.source).slice(0, 5000) : '';

          await service.from('sequence_enrollments').update({ status: 'paused' }).eq('id', sentLog.sequence_enrollment_id);
          await service.from('email_replies').insert({
            email_log_id: sentLog.id, lead_id: sentLog.lead_id, org_id: sentLog.org_id,
            from_email: fromAddr, subject, body: bodyText, received_at: new Date().toISOString(),
          });
          matched++;

          const { data: enrollment } = await service.from('sequence_enrollments')
            .select('sequence:email_sequences(auto_draft_on_reply)').eq('id', sentLog.sequence_enrollment_id).single();
          const autoDraft = (enrollment as { sequence: { auto_draft_on_reply: boolean } | null } | null)?.sequence?.auto_draft_on_reply;
          if (!autoDraft) continue;

          const apiKey = await resolveOrgApiKey(service, sentLog.org_id, 'anthropic');
          if (!apiKey) continue;
          const { data: notesRows } = await service.from('lead_notes')
            .select('content').eq('lead_id', sentLog.lead_id).order('created_at', { ascending: false }).limit(5);
          const noteTexts = (notesRows ?? []).map((n) => (n as { content: string }).content);

          try {
            const complexity = await classifyReply({ replyBody: bodyText, apiKey });
            const { data: org } = await service.from('organizations').select('name').eq('id', sentLog.org_id).maybeSingle();
            const draft = await draftEmailClaude({
              subject: `Re: ${subject}`, body: `They replied:\n\n${bodyText}\n\nDraft a helpful response.`,
              lead, notes: noteTexts, contractorName, orgName: org?.name ?? 'our team',
              apiKey, model: complexity === 'complex' ? 'claude-sonnet-5' : 'claude-haiku-4-5',
            });
            await service.from('email_logs').insert({
              // to_email is the verified lead.email, never fromAddr — fromAddr comes
              // straight off an unauthenticated header and must never be used as a
              // send target, even after the match/sender validation above.
              lead_id: sentLog.lead_id, sequence_enrollment_id: sentLog.sequence_enrollment_id,
              sent_by: null, to_email: lead.email, subject: draft.subject, body: draft.body,
              status: 'draft', org_id: sentLog.org_id,
            });
          } catch (e) {
            console.error(`reply auto-draft failed for lead ${sentLog.lead_id}:`, e);
          }
        }
      } finally {
        lock.release();
      }
      await client.logout();
      await service.from('user_email_settings')
        .update({ last_imap_check_at: new Date().toISOString(), last_imap_check_uid: highestUid })
        .eq('user_id', u.user_id);
    } catch (e) {
      errors.push({ user_id: u.user_id, error: e instanceof Error ? e.message : String(e) });
      try { await client?.logout(); } catch { /* already disconnected */ }
    }
  }

  return json({ matched, bounces, errors }, 200, HEADERS);
});
