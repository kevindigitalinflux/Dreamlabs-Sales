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
  // noise before it ever reaches a real phone number on the page. Tags are
  // replaced with '|', not a space — a space sits inside this function's own
  // digit-group character class, so two numbers markup used to keep apart
  // (a stat block, a list of years) would otherwise merge into one fake
  // match. '|' breaks that merge; the tradeoff is a number split across an
  // inline tag (`Call 020 <b>7946</b> 0958`) is missed, which is a safe
  // null rather than a fabricated number.
  const text = html
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, '|')
    .replace(/<[^>]*>/g, '|');
  const plain = text.match(/(?<![\w.@])(\+?\d[\d\s()-]{7,17}\d)(?![\w.@])/);
  return plain ? plain[1].trim() : null;
}

// Blocks the direct SSRF vectors (loopback, RFC1918 ranges, link-local incl.
// the 169.254.169.254 cloud metadata address, and non-http(s) schemes like
// file:// or gopher://) for a caller-supplied website URL. Does not defend
// against DNS rebinding (a public hostname resolving to a private IP at
// fetch time) — Deno's edge runtime doesn't expose a pre-fetch DNS resolve
// step here, so this is a static check on the literal URL, not the network.
function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::1') return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  return false;
}

function parseSafeWebsiteUrl(website: string): URL | null {
  let url: URL;
  try {
    url = new URL(website);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (isPrivateOrLoopbackHost(url.hostname)) return null;
  return url;
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
  const url = parseSafeWebsiteUrl(website);
  if (!url) return { email: null, phone: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
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
