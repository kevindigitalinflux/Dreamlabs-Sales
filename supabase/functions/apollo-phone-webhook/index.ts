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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  const url = new URL(req.url);
  const candidateId = url.searchParams.get('candidate_id');
  const token = url.searchParams.get('token');
  const expected = Deno.env.get('APOLLO_WEBHOOK_SECRET');
  if (!expected || !token || token !== expected || !candidateId) {
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
