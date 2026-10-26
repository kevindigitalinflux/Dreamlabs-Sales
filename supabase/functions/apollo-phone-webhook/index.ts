// supabase/functions/apollo-phone-webhook/index.ts
//
// PUBLIC endpoint — Apollo calls this directly, with no Supabase auth of any
// kind. verify_jwt MUST be false for this function (set at deploy time).
// Apollo documents no signature/verification scheme for this callback at
// all, so the `token` query param compared below IS the entire security
// boundary. Never log its value.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { computeWebhookToken } from '../_shared/webhookToken.ts';
import { apolloPhoneEvidence, apolloPhonePatch } from '../_shared/apolloPhone.ts';
import type { PhoneMetadata } from '../_shared/phoneNumbers.ts';

interface ApolloPhoneNumber { raw_number?: string; type_cd?: string }
interface ApolloWebhookPerson { id?: string; phone_numbers?: ApolloPhoneNumber[] }

/**
 * Constant-time string equality via SHA-256 digest + XOR-accumulation
 * comparison. Used to compare the caller-supplied token against the expected
 * secret without leaking timing information (a plain `!==` on the raw
 * strings would let an attacker recover the secret byte-by-byte via timing).
 */
async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  const url = new URL(req.url);
  const candidateId = url.searchParams.get('candidate_id');
  const token = url.searchParams.get('token');
  const secret = Deno.env.get('APOLLO_WEBHOOK_SECRET');
  if (!secret || !token || !candidateId) {
    return new Response(null, { status: 401 });
  }
  const expected = await computeWebhookToken(secret, candidateId);
  if (!(await timingSafeEqualStrings(token, expected))) {
    return new Response(null, { status: 401 });
  }

  try {
    const body = await req.json() as { people?: ApolloWebhookPerson[] };
    const person = body.people?.[0];
    const phones = person?.phone_numbers ?? [];

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: candidate, error: readError } = await service
      .from('decision_maker_candidates').select('id, lead_id, phone, phone_status, dismissed_at, leads!inner(country, phone_meta)').eq('id', candidateId).maybeSingle();
    if (readError) { console.error('Apollo phone callback: contact could not be read'); return new Response(null, { status: 500 }); }
    if (!candidate) return new Response(null, { status: 200 }); // nothing to update, not Apollo's problem

    if (candidate.dismissed_at || candidate.phone || candidate.phone_status !== 'pending') return new Response(null, { status: 200 });
    const lead = candidate.leads as unknown as { country?: unknown; phone_meta: Record<string, PhoneMetadata> };
    const foundAt = new Date().toISOString();
    const evidence = apolloPhoneEvidence(phones, lead.country, foundAt);
    if (evidence) {
      const previous = lead.phone_meta[evidence.value];
      const saved = await service.from('leads').update({ phone_meta: { ...lead.phone_meta,
        [evidence.value]: { ...evidence, ...previous, original: previous?.original ?? evidence.original },
      } }).eq('id', candidate.lead_id).eq('phone_meta', lead.phone_meta).select('id').maybeSingle();
      if (saved.error || !saved.data) { console.error('Apollo phone callback: original phone evidence could not be saved'); return new Response(null, { status: 500 }); }
    }
    const { error } = await service.from('decision_maker_candidates')
      .update({ ...apolloPhonePatch(phones, lead.country, foundAt), updated_at: foundAt })
      .eq('id', candidateId).eq('phone_status', 'pending').is('dismissed_at', null).is('phone', null);
    if (error) { console.error('Apollo phone callback: phone could not be saved'); return new Response(null, { status: 500 }); }
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error('Apollo phone callback: invalid callback', error instanceof Error ? error.name : 'UnknownError');
    // Never let a parsing error surface as a 5xx that might make Apollo
    // retry indefinitely — this is a best-effort callback, not a
    // caller-facing API.
    return new Response(null, { status: 200 });
  }
});
