// supabase/functions/_shared/knownPerson.ts
// Pure helpers for the "known person" lookup (find-decision-makers). No imports on purpose: tested from src/lib.

/** The contact fields the lookup may fill. */
export interface PersonFields {
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
}

/** Values found by a provider lookup. */
export type FoundFields = PersonFields;

/** Result of merging found values into a person. */
export interface MergeResult {
  /** Columns to write: only fields that were blank. */
  patch: Record<string, string>;
  /** The email / phone / LinkedIn values that were actually filled (title is patched but not reported). */
  applied: { email?: string; phone?: string; linkedin_url?: string };
  /** A found email that differs from the person's existing one: offered to the user, never saved. */
  extra_email?: string;
}

function text(value: string | null | undefined): string | null {
  const t = (value ?? '').trim();
  return t === '' ? null : t;
}

/**
 * Fills ONLY blank fields (email, phone, linkedin_url, title) of a person from found values.
 * A non-blank existing value is never overwritten. A found email that differs (case-insensitively)
 * from a non-blank existing email is returned as `extra_email` instead of being saved.
 */
export function mergeFoundIntoPerson(existing: PersonFields, found: FoundFields): MergeResult {
  const patch: Record<string, string> = {};
  const applied: MergeResult['applied'] = {};
  let extra_email: string | undefined;

  const foundEmail = text(found.email)?.toLowerCase() ?? null;
  const haveEmail = text(existing.email);
  if (foundEmail) {
    if (!haveEmail) {
      patch.email = foundEmail;
      applied.email = foundEmail;
    } else if (haveEmail.toLowerCase() !== foundEmail) {
      extra_email = foundEmail;
    }
  }
  const foundPhone = text(found.phone);
  if (foundPhone && !text(existing.phone)) {
    patch.phone = foundPhone;
    applied.phone = foundPhone;
  }
  const foundUrl = text(found.linkedin_url);
  if (foundUrl && !text(existing.linkedin_url)) {
    patch.linkedin_url = foundUrl;
    applied.linkedin_url = foundUrl;
  }
  const foundTitle = text(found.title);
  if (foundTitle && !text(existing.title)) patch.title = foundTitle;

  return extra_email ? { patch, applied, extra_email } : { patch, applied };
}

/**
 * Bare lowercase domain from a website string (scheme, www., port, path, query and fragment removed).
 * Null for anything that is not a plausible hostname (credentials, no dot, odd characters).
 */
export function domainFromWebsite(website: string | null | undefined): string | null {
  let s = (website ?? '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0] ?? '';
  if (s.includes('@')) return null;
  s = s.replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.+$/, '');
  if (!s.includes('.')) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  return s;
}

/** What went wrong with a provider call: an HTTP status, or a non-HTTP failure. */
export type LookupFailure = number | 'timeout' | 'network';

/** Plain-English message for a failed provider lookup. Fixed strings only: never includes keys or provider text. */
export function plainLookupError(provider: 'hunter' | 'apollo', failure: LookupFailure): string {
  const name = provider === 'hunter' ? 'Hunter' : 'Apollo';
  if (failure === 401 || failure === 403) return `${name} did not accept the saved API key, so nothing was looked up.`;
  if (failure === 402) return `${name} says this account is out of credits, so nothing was looked up.`;
  if (failure === 429) return `${name} is limiting requests right now. Try again in a few minutes.`;
  if (failure === 'timeout') return `${name} took too long to answer. Try again in a moment.`;
  return `${name} could not be reached right now.`;
}
