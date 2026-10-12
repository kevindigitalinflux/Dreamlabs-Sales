// supabase/functions/_shared/timingSafe.ts
// Constant-time string comparison (same method as apollo-phone-webhook). No imports: uses Web Crypto only.

/**
 * Constant-time string equality via SHA-256 digests compared with XOR-accumulation, so the time taken does not
 * depend on where the strings differ. Use for secrets such as the cron secret.
 */
export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i]! ^ bytesB[i]!;
  return diff === 0;
}

/** True only when a secret is configured and the presented value equals it (fails closed when either is missing). */
export async function cronSecretMatches(presented: string | null, configured: string | undefined | null): Promise<boolean> {
  if (!configured || !presented) return false;
  return await timingSafeEqualStrings(presented, configured);
}
