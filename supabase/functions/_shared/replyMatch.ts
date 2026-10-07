// Import-free helper so it can be tested from src/lib and used by check-replies.

/**
 * True when a reply's From address is the person we emailed (the sent log's to_email) or the lead's own email,
 * ignoring case and surrounding spaces. Empty values never match.
 */
export function replySenderMatches(from: string | null | undefined, toEmail: string | null | undefined, leadEmail: string | null | undefined): boolean {
  const f = (from ?? '').trim().toLowerCase();
  if (!f) return false;
  return [toEmail, leadEmail].some((e) => (e ?? '').trim().toLowerCase() === f);
}
