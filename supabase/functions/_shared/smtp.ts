import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string | null;
}

/** Sends one plain-text email. Port 465 = implicit TLS; anything else attempts STARTTLS. */
export async function sendMail(
  cfg: SmtpConfig,
  msg: { to: string; subject: string; body: string },
): Promise<void> {
  const client = new SMTPClient({
    connection: {
      hostname: cfg.host,
      port: cfg.port,
      tls: cfg.port === 465,
      auth: { username: cfg.user, password: cfg.pass },
    },
  });
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
    });
  } finally {
    try {
      await client.close();
    } catch {
      // ignore close errors — the send result above is what matters
    }
  }
}
