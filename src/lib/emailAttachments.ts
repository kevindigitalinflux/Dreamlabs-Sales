import { supabase } from './supabase';

// Mirrors supabase/functions/_shared/emailAttachments.ts — keep the two in sync.

/** A file attached to every email made from a template (or to one draft). `path` is inside the private bucket. */
export interface EmailAttachment { path: string; name: string; type: string; size: number }
/** A link appended to the email body. Videos are just links (pasted, or an uploaded video's hosted URL). */
export interface EmailLink { label: string; url: string }

export const ATTACHMENT_BUCKET = 'email-attachments';
export const MEDIA_BUCKET = 'email-media';
export const ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
/** Total attached bytes per email: Gmail rejects ~25 MB and base64 inflates ~33%, so stay well under. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Supabase's per-file ceiling on the Free plan; longer videos belong on YouTube/Vimeo/Drive as a pasted link. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** "1.4 MB" / "230 KB" for a byte count. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Checks a file about to be attached: PDF/PNG/JPEG only, and the running total for
 * the email must stay within the limit. Returns an error message, or null if fine.
 */
export function validateAttachmentFile(file: { type: string; size: number; name: string }, currentTotalBytes: number): string | null {
  if (!ATTACHMENT_TYPES.includes(file.type)) return `${file.name}: only PDF, PNG and JPEG files can be attached.`;
  if (currentTotalBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
    return `${file.name} is too big: attachments can total ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} per email (currently ${formatBytes(currentTotalBytes)}).`;
  }
  return null;
}

/** Checks a video file about to be uploaded and hosted as a link. Returns an error message, or null if fine. */
export function validateVideoFile(file: { type: string; size: number; name: string }): string | null {
  if (!VIDEO_TYPES.includes(file.type)) return `${file.name}: only MP4, MOV and WebM videos can be uploaded.`;
  if (file.size > MAX_VIDEO_BYTES) return `${file.name} is over ${formatBytes(MAX_VIDEO_BYTES)}. Upload it to YouTube, Vimeo or Drive and paste the link instead.`;
  return null;
}

/** Trims and checks a pasted link: must be a real http(s) URL (a bare "example.com/x" gets https://). Returns the URL or null. */
export function normalizeLinkUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The links block as it will read at the end of the email body (same format the server appends). */
export function linksBlock(links: EmailLink[]): string {
  if (links.length === 0) return '';
  return `Links:\n${links.map((l) => (l.label === l.url ? l.url : `${l.label}: ${l.url}`)).join('\n')}`;
}

/** Storage-safe object name: keeps the extension, drops anything unusual. */
function objectName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';
}

/** Uploads a PDF/image into the org's private attachments folder and returns the reference to store. */
export async function uploadAttachment(orgId: string, file: File): Promise<{ attachment?: EmailAttachment; error?: string }> {
  const path = `${orgId}/${crypto.randomUUID()}/${objectName(file.name)}`;
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, file, { contentType: file.type });
  if (error) return { error: error.message };
  return { attachment: { path, name: file.name, type: file.type, size: file.size } };
}

/** Uploads a video into the public media bucket and returns the shareable URL (the path holds a random UUID). */
export async function uploadVideo(orgId: string, file: File): Promise<{ url?: string; error?: string }> {
  const path = `${orgId}/${crypto.randomUUID()}/${objectName(file.name)}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type });
  if (error) return { error: error.message };
  return { url: supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl };
}
