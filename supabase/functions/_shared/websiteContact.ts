// Asset/image extensions that commonly appear as the "TLD" portion of a
// false-positive plain-text email match (e.g. `logo@2x.png` in a srcset).
const NON_EMAIL_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico']);

function extractEmail(html: string): string | null {
  const mailto = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (mailto) return mailto[1];
  const plain = html.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.([a-zA-Z]{2,})\b/);
  if (!plain) return null;
  const tld = plain[1].toLowerCase();
  return NON_EMAIL_TLDS.has(tld) ? null : plain[0];
}

function extractPhone(html: string): string | null {
  const tel = html.match(/tel:([+\d][\d\s()-]{6,18}\d)/);
  if (tel) return tel[1].trim();
  // Plain-text fallback runs on tag-stripped text, not raw HTML — otherwise
  // it matches SVG viewBox attributes, CSS pixel values, and other markup
  // noise before it ever reaches a real phone number on the page.
  const text = html
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  const plain = text.match(/(?<![\w.@])(\+?\d[\d\s()-]{7,17}\d)(?![\w.@])/);
  return plain ? plain[1].trim() : null;
}

/**
 * Best-effort: fetch a business website and pull a plausible contact email
 * and phone number from it. Free — no API key. Never throws; a timeout,
 * network error, or hostile/broken site just yields nulls (one bad lookup
 * must never fail the caller's batch).
 */
export async function scrapeWebsiteContact(
  website: string | null | undefined,
): Promise<{ email: string | null; phone: string | null }> {
  if (!website) return { email: null, phone: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(website, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { email: null, phone: null };
    const html = await res.text();
    return { email: extractEmail(html), phone: extractPhone(html) };
  } catch {
    return { email: null, phone: null };
  } finally {
    // Keep the abort signal armed through the full res.text() read, not just
    // the initial fetch() resolution (which only waits for headers).
    clearTimeout(timeout);
  }
}
