/** A display-only external website URL. Stored values are never changed. */
export function websiteHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || /[\s\\\u0000-\u001f\u007f]/.test(text) || text.startsWith('//')) return null;
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(text) && !/^[^/?#:]+:\d+(?:[/?#]|$)/.test(text);
  if (hasScheme && !/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(hasScheme ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const labels = url.hostname.split('.');
    if (labels.length < 2 || labels.some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return null;
    return url.href;
  } catch { return null; }
}
