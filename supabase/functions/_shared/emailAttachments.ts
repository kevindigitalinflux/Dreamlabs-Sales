// supabase/functions/_shared/emailAttachments.ts
// Deno copy of the shapes/limits in src/lib/emailAttachments.ts — keep the two in sync
// (same convention as templateVars.ts's Deno/browser split).

export interface EmailAttachment { path: string; name: string; type: string; size: number }
export interface EmailLink { label: string; url: string }

export const ATTACHMENT_BUCKET = 'email-attachments';
export const ALLOWED_ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
/** Total attached bytes per email. Gmail rejects ~25 MB messages and base64 inflates ~33%, so stay well under. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const MAX_LINKS = 20;

/** Whitelist-parses a JSON value into attachments, dropping anything malformed or of a disallowed type. */
export function parseAttachments(raw: unknown): EmailAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: EmailAttachment[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.path !== 'string' || typeof r.name !== 'string' || typeof r.type !== 'string') continue;
    if (!ALLOWED_ATTACHMENT_TYPES.includes(r.type)) continue;
    const size = typeof r.size === 'number' && Number.isFinite(r.size) && r.size >= 0 ? r.size : 0;
    out.push({ path: r.path, name: r.name.slice(0, 200), type: r.type, size });
  }
  return out.slice(0, MAX_ATTACHMENTS);
}

/** Whitelist-parses links: http(s) URLs only (a stored value is never trusted), label falls back to the URL. */
export function parseLinks(raw: unknown): EmailLink[] {
  if (!Array.isArray(raw)) return [];
  const out: EmailLink[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.url !== 'string') continue;
    let url: URL;
    try { url = new URL(r.url.trim()); } catch { continue; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    const label = typeof r.label === 'string' ? r.label.replace(/[\r\n]+/g, ' ').trim().slice(0, 120) : '';
    out.push({ label: label || url.href, url: url.href });
  }
  return out.slice(0, MAX_LINKS);
}

/**
 * Appends the template's links (videos included) to the END of a plain-text email.
 * Done after any AI personalisation so the model can never drop or rewrite a URL.
 */
export function appendLinks(body: string, links: EmailLink[]): string {
  if (links.length === 0) return body;
  const lines = links.map((l) => (l.label === l.url ? l.url : `${l.label}: ${l.url}`));
  return `${body.trimEnd()}\n\nLinks:\n${lines.join('\n')}`;
}

/**
 * denomailer writes the filename into MIME headers unquoted, so a space or a
 * quote in "Price List (2026).pdf" corrupts the message. Keep it to safe characters.
 */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'attachment';
}

/**
 * Keeps only attachments stored under this organisation's own folder. A shared
 * (org-less) default template could carry files uploaded by another org; send-email
 * refuses those, so drafting drops them instead of creating a draft that can never send.
 */
export function onlyOrgAttachments(attachments: EmailAttachment[], orgId: string): EmailAttachment[] {
  return attachments.filter((a) => a.path.startsWith(`${orgId}/`) && !a.path.includes('..'));
}
