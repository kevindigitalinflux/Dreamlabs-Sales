// supabase/functions/_shared/domain.ts
/** Strips protocol and leading www. to get a bare domain Apollo/Hunter expect (e.g. "example.com"). */
export function bareDomain(website: string): string | null {
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
