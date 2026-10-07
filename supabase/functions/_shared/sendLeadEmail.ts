import { sendMail } from './smtp.ts';
import { ATTACHMENT_BUCKET, MAX_TOTAL_ATTACHMENT_BYTES, parseAttachments, safeFilename } from './emailAttachments.ts';

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

export interface SendLeadEmailInput {
  /** The user whose mailbox (user_email_settings + Vault password) sends this email. Also written to email_logs.sent_by. */
  senderId: string;
  to: string;
  subject: string;
  body: string;
  /**
   * The lead being emailed. Normally a real lead id. send-email's update-only
   * calls (log_id with no lead_id) pass null/undefined, which is preserved
   * as today: the email_logs row's lead_id is written as null.
   */
  leadId?: string | null;
  /** An existing draft row to update; omit to insert a new email_logs row. */
  logId?: string | null;
  /** Only written when not undefined (see the comment in the row-building code). */
  decisionMakerCandidateId?: string | null;
  /** Explicit attachment list; when undefined the stored draft's attachments are used. */
  attachments?: unknown;
}

export type SendLeadEmailResult =
  | { ok: true; logId: string | null; warning?: string }
  | { ok: false; error: string; status?: number; logId?: string | null; warning?: string };

/**
 * Sends one email as `input.senderId` and records it. Extracted unchanged from
 * the post-authorization half of the send-email edge function.
 *
 * WARNING: THIS FUNCTION DOES NO AUTHORIZATION. It trusts its caller completely.
 * It does not check who is calling, whether the lead belongs to any particular
 * org, whether `senderId` is a member of the lead's org, or whether `logId`
 * (a draft) is owned by `senderId`. It runs with whatever client it is given
 * (the service role, which bypasses RLS) and WILL send from the sender's
 * mailbox and write to the lead. Any caller using the service role (e.g. the
 * autopilot engine, which has no user JWT) MUST, BEFORE calling:
 *   1. verify the lead belongs to the run's org, and
 *   2. verify the sender is allowed to send for that org/lead, and
 *   3. if passing `logId`, verify that draft belongs to that org/sender.
 * The send-email HTTP handler does these checks via the caller's JWT.
 *
 * Does: loads the sender's verified SMTP settings and Vault password, validates
 * and loads attachments, sends via sendMail, writes/updates the email_logs row
 * (status 'sent' or 'failed'), sets leads.last_contacted_at on success and
 * advances stage new_lead to contacted ONLY (never any other stage).
 *
 * Result: `{ ok: true, logId }` on success (`logId` is null if logging failed;
 * `warning` is then set). On failure `{ ok: false, error }`; `status` is the
 * HTTP status send-email must return for it (400 for every failure today), and
 * `logId`/`warning` are set when a log row was written for a failed SMTP send.
 */
export async function sendLeadEmail(service: ServiceClient, input: SendLeadEmailInput): Promise<SendLeadEmailResult> {
  const { senderId } = input;
  const leadId = input.leadId ?? null;

  const { data: settings } = await service
    .from('user_email_settings').select('*').eq('user_id', senderId).maybeSingle();
  if (!settings?.is_verified) return { ok: false, error: 'Set up and verify your email in Settings → Email sending first', status: 400 };
  const { data: pass } = await service.rpc('app_get_smtp_secret', { uid: senderId });
  if (!pass) return { ok: false, error: 'No stored email password — re-save your settings', status: 400 };

  let orgId: string | null = null;
  let leadStage: string | null = null;
  if (leadId) {
    const { data: lead } = await service.from('leads').select('org_id, stage').eq('id', leadId).maybeSingle();
    orgId = (lead as { org_id: string; stage: string } | null)?.org_id ?? null;
    leadStage = (lead as { org_id: string; stage: string } | null)?.stage ?? null;
  }
  if (!orgId && !input.logId) return { ok: false, error: 'lead_id is required to send a new email', status: 400 };

  // The stored draft's attachments and org (the draft's ownership was already
  // checked by the caller).
  let draftAttachments: unknown = [];
  let draftOrgId: string | null = null;
  if (input.logId) {
    const { data: log } = await service.from('email_logs').select('org_id, attachments').eq('id', input.logId).single();
    if (log) {
      draftAttachments = log.attachments;
      draftOrgId = log.org_id as string | null;
    }
  }

  // What to attach: the caller's explicit list when given (the composer can add/remove
  // files for one email), otherwise whatever the stored draft carries (bulk release,
  // sequence drafts). parseAttachments drops anything malformed or of a disallowed type.
  const attachments = parseAttachments(input.attachments !== undefined ? input.attachments : draftAttachments);
  // Files are namespaced <org_id>/...; only ever attach ones inside the lead's/draft's own org,
  // so a crafted request can't make this function mail another organisation's documents.
  const attachOrgId = orgId ?? draftOrgId;
  if (attachments.length > 0) {
    if (!attachOrgId || attachments.some((a) => !a.path.startsWith(`${attachOrgId}/`) || a.path.includes('..'))) {
      return { ok: false, error: 'Attachment not allowed', status: 400 };
    }
    if (attachments.reduce((sum, a) => sum + a.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
      return { ok: false, error: 'Attachments are over the 10 MB limit for one email', status: 400 };
    }
  }

  let status = 'sent';
  let errorMessage: string | null = null;
  let messageId: string | null = null;
  try {
    // Load every file BEFORE sending: if one can't be read the whole send fails, rather than
    // quietly sending the email without the price list the lead asked for.
    const files: { filename: string; contentType: string; content: Uint8Array }[] = [];
    let loadedBytes = 0;
    for (const a of attachments) {
      const { data: blob, error: dlErr } = await service.storage.from(ATTACHMENT_BUCKET).download(a.path);
      if (dlErr || !blob) throw new Error(`Attachment "${a.name}" could not be loaded`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      loadedBytes += bytes.length;
      if (loadedBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Attachments are over the 10 MB limit for one email');
      files.push({ filename: safeFilename(a.name), contentType: a.type, content: bytes });
    }
    const result = await sendMail(
      { host: settings.smtp_host, port: settings.smtp_port, user: settings.smtp_user, pass: pass as string, fromName: settings.from_name },
      { to: input.to, subject: input.subject, body: input.body, attachments: files },
    );
    messageId = result.messageId;
  } catch (e) {
    status = 'failed';
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  const row: Record<string, unknown> = {
    lead_id: leadId, sent_by: senderId, to_email: input.to,
    subject: input.subject, body: input.body, status, error_message: errorMessage,
    message_id: messageId, sent_at: new Date().toISOString(),
    attachments, // what this email actually carried, for the sent-mail history
  };
  // Only touch decision_maker_candidate_id when the caller actually supplied
  // it. Omitting the key entirely (rather than defaulting to null) matters
  // on the update path: ReleaseQueue's bulk release calls this with log_id
  // only, and this update runs against an EXISTING row that may already
  // carry real attribution set at draft time — always writing `?? null`
  // here silently wiped it on every bulk release (see I1 in the
  // 2026-09-28 final review).
  if (input.decisionMakerCandidateId !== undefined) {
    row.decision_maker_candidate_id = input.decisionMakerCandidateId;
  }
  if (orgId) row.org_id = orgId; // omitted on update-only calls where org_id is already set on the existing row
  let logId = input.logId ?? null;
  let logFailed = false;
  if (logId) {
    // Matches the ownership check in the caller: a claimed system-generated
    // draft's existing row still has sent_by = null at this point (row.sent_by
    // above is the NEW value being written), so an `.eq('sent_by', senderId)`
    // filter here would match zero rows and silently no-op the update — the
    // email would send but the log would stay stuck on 'draft' forever.
    const { error: logErr } = await service.from('email_logs').update(row).eq('id', logId).or(`sent_by.is.null,sent_by.eq.${senderId}`);
    if (logErr) {
      console.error('email_logs update failed:', logErr.message);
      logFailed = true;
    }
  } else {
    const { data: inserted, error: logErr } = await service.from('email_logs').insert(row).select('id').single();
    if (logErr) {
      console.error('email_logs insert failed:', logErr.message);
      logFailed = true;
    }
    logId = (inserted as { id: string } | null)?.id ?? null;
  }

  // Best-effort: update the lead's last-contacted timestamp on every
  // successful send through this function (manual, sequence, or bulk
  // release) — and advance a brand-new lead to "contacted" specifically,
  // never touching any other stage so a reply to an already-advanced lead
  // is never silently reset backward. A failure here must not turn a
  // successful send into an error response — the email already sent and
  // logged either way.
  if (status === 'sent' && leadId) {
    const leadUpdate: Record<string, unknown> = { last_contacted_at: new Date().toISOString() };
    if (leadStage === 'new_lead') leadUpdate.stage = 'contacted';
    await service.from('leads').update(leadUpdate).eq('id', leadId);
  }

  const warning = logFailed ? 'Email sent but logging failed' : undefined;
  if (status === 'failed') return { ok: false, error: 'Send failed: ' + errorMessage, status: 400, logId, ...(warning ? { warning } : {}) };
  return { ok: true, logId, ...(warning ? { warning } : {}) };
}
