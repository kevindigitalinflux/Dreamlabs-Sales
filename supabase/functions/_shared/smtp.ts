import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string | null;
}

/**
 * Sends one plain-text email. Port 465 = implicit TLS; anything else attempts
 * STARTTLS. Generates and sets an explicit Message-ID (denomailer doesn't
 * expose one from its send result) and returns it, so the caller can store
 * it for later reply-matching via In-Reply-To/References headers.
 */
export async function sendMail(
  cfg: SmtpConfig,
  msg: { to: string; subject: string; body: string; attachments?: { filename: string; contentType: string; content: Uint8Array }[] },
): Promise<{ messageId: string }> {
  const client = new SMTPClient({
    connection: {
      hostname: cfg.host,
      port: cfg.port,
      tls: cfg.port === 465,
      auth: { username: cfg.user, password: cfg.pass },
    },
  });
  const domain = cfg.user.split('@')[1] ?? 'dreamlabs-sales.app';
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  // strip CR/LF — SMTP header injection guard
  const fromName = cfg.fromName ? cfg.fromName.replace(/[\r\n]+/g, ' ').trim() : cfg.fromName;
  const to = msg.to.replace(/[\r\n]+/g, ' ').trim();
  const subject = msg.subject.replace(/[\r\n]+/g, ' ').trim();
  try {
    await client.send({
      from: fromName ? `${fromName} <${cfg.user}>` : cfg.user,
      to,
      subject,
      content: msg.body,
      headers: { 'Message-ID': messageId },
      // denomailer base64-encodes 'binary' attachments itself. Filenames must already be
      // safe (see safeFilename): it writes them into MIME headers unquoted.
      ...(msg.attachments && msg.attachments.length > 0
        ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, encoding: 'binary' as const, content: a.content })) }
        : {}),
    });
  } finally {
    try {
      await client.close();
    } catch {
      // ignore close errors — the send result above is what matters
    }
  }
  return { messageId };
}
