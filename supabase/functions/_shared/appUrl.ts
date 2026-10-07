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
