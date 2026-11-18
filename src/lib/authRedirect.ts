/**
 * The address Supabase should send a person back to after Google sign-in, a password reset or an invite: the address
 * they are already on, plus a path. Written once and tested so a later change cannot quietly swap in a fixed address
 * (the sign-in landing on the old workers.dev address was first suspected to be exactly that).
 * Throws when `origin` is not an http or https address, or `path` does not start with a slash.
 */
export function authRedirectUrl(path: string, origin: string): string {
  if (!path.startsWith('/')) throw new Error('The return path must start with a slash.');
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('The return address is not a valid web address.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('The return address must be http or https.');
  return `${parsed.origin}${path}`;
}
