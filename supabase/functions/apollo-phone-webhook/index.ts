// supabase/functions/apollo-phone-webhook/index.ts
//
// PUBLIC endpoint — Apollo calls this directly, with no Supabase auth of any
// kind. verify_jwt MUST be false for this function (set at deploy time).
// Apollo documents no signature/verification scheme for this callback at
// all, so the `token` query param compared below IS the entire security
// boundary. Never log its value.
import { createClient } from 'npm:@supabase/supabase-js@2';

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
  const expected = Deno.env.get('APOLLO_WEBHOOK_SECRET');
  if (!expected || !token || !candidateId || !(await timingSafeEqualStrings(token, expected))) {
    return new Response(null, { status: 401 });
  }

  try {
    const body = await req.json() as { people?: ApolloWebhookPerson[] };
    const person = body.people?.[0];
    const phones = person?.phone_numbers ?? [];
    const mobile = phones.find((p) => p.type_cd === 'mobile');
    const chosen = mobile ?? phones[0];

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: candidate } = await service
      .from('decision_maker_candidates').select('id, lead_id').eq('id', candidateId).maybeSingle();
    if (!candidate) return new Response(null, { status: 200 }); // nothing to update, not Apollo's problem

    if (chosen?.raw_number) {
      await service.from('decision_maker_candidates')
        .update({ phone: chosen.raw_number, phone_status: 'revealed', updated_at: new Date().toISOString() })
        .eq('id', candidateId);
      await service.from('leads').update({ phone: chosen.raw_number }).eq('id', candidate.lead_id);
    } else {
      await service.from('decision_maker_candidates')
        .update({ phone_status: 'not_found', updated_at: new Date().toISOString() })
        .eq('id', candidateId);
    }
    return new Response(null, { status: 200 });
  } catch {
    // Never let a parsing error surface as a 5xx that might make Apollo
    // retry indefinitely — this is a best-effort callback, not a
    // caller-facing API.
    return new Response(null, { status: 200 });
  }
});
