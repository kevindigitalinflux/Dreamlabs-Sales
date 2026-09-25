/**
 * Derives a per-candidate webhook token from the shared APOLLO_WEBHOOK_SECRET,
 * so the raw secret never leaves the platform (Apollo only ever sees a token
 * scoped to one candidate_id, not the secret itself).
 */
export async function computeWebhookToken(secret: string, candidateId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(candidateId));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
