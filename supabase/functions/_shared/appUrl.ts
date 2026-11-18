// Import-free helper so it can be tested from src/lib and used by templateVars.ts.

/**
 * The public base URL used in links inside emails (e.g. the unsubscribe link).
 * Prefers APP_PUBLIC_URL, else the first https:// entry of the comma separated APP_ORIGINS, else the first entry
 * (local development). Trailing slashes are removed.
 */
export function publicAppUrl(appPublicUrl: string | null | undefined, appOrigins: string | null | undefined): string {
  const clean = (s: string) => s.trim().replace(/\/+$/, '');
  const explicit = appPublicUrl ? clean(appPublicUrl) : '';
  if (explicit) return explicit;
  const origins = (appOrigins ?? '').split(',').map(clean).filter(Boolean);
  return origins.find((o) => o.startsWith('https://')) ?? origins[0] ?? 'http://localhost:5173';
}

/**
 * Whether an invite's return address is one this app may send people back to: its origin (scheme, host and port)
 * must be exactly one of the allowed app origins, and its path exactly `/welcome`. Replaces a "starts with" check
 * that let `https://sales.didreamlabs.com.example.org/welcome` and `https://sales.didreamlabs.com@example.org/welcome` through.
 */
export function isAllowedInviteRedirect(redirectTo: string, appOrigins: string | null | undefined): boolean {
  let target: URL;
  try {
    target = new URL(redirectTo);
  } catch {
    return false;
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false;
  if (target.username || target.password || target.search || target.hash) return false;
  if (target.pathname !== '/welcome') return false;
  const allowed = (appOrigins ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  return allowed.some((o) => {
    try {
      return new URL(o).origin === target.origin;
    } catch {
      return false;
    }
  });
}
