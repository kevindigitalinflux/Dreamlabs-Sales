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
  try {
    await client.send({
      from: cfg.fromName ? `${cfg.fromName} <${cfg.user}>` : cfg.user,
      to: msg.to,
      subject: msg.subject,
      content: msg.body,
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}
