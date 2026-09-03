// supabase/functions/draft-linkedin-message/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { draftEmailClaude } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await client.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);

  const body = (await req.json()) as { contact_id?: string };
  const contactId = String(body.contact_id ?? '');
  if (!contactId) return json({ error: 'contact_id is required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: contact, error: contactErr } = await service
    .from('linkedin_contacts').select('*').eq('id', contactId).single();
  if (contactErr || !contact) return json({ error: 'Contact not found' }, 404, headers);

  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', contact.org_id).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  // Resolve the calling user's own name (same pattern as check-replies/index.ts)
  // instead of the hardcoded 'there' placeholder, which read badly in a real
  // drafted message to a real prospect. Fall back to a complete phrase with
  // no further processing if no profile is found, so it can't be mangled by
  // .split(' ')[0].
  const { data: callerProfile } = await service
    .from('profiles').select('full_name, email').eq('id', userData.user.id).maybeSingle();
  const resolvedCallerName = callerProfile?.full_name ?? callerProfile?.email;
  const contractorName = resolvedCallerName ? resolvedCallerName.split(' ')[0]! : 'the team';

  const apiKey = await resolveOrgApiKey(service, contact.org_id, 'anthropic');
  if (!apiKey) return json({ error: 'No Anthropic API key configured for this organization' }, 400, headers);

  const variant: 'achievement' | 'life_update' | 'general' = contact.context_signal
    ? (contact.context_signal.toLowerCase().includes('job') || contact.context_signal.toLowerCase().includes('promot') ? 'life_update' : 'achievement')
    : 'general';

  const templates: Record<typeof variant, string> = {
    achievement: `Hey {{first_name}}, saw you ${contact.context_signal}. That's a big deal, well done.\n\nRandom one for you, do you know any service business owners who are drowning in manual admin and want to automate parts of it? I'm taking on 5 free case studies right now to build out proof for my agency (I'm a designer who taught myself to build this stuff, and we built the whole backend for my own cleaning company, Mr Brush, so I know it works), just need real businesses to test it on and leave an honest review after.\n\nAnyone come to mind?`,
    life_update: `{{first_name}}, congrats on ${contact.context_signal}. Hope it's treating you well.\n\nQuick one, I'm looking for 5 SME owners to run free automation pilots for (built by my agency, proven on my own cleaning company Mr Brush first). If no, no worries, does anyone you know (or hate) come to mind who's stuck doing everything manually?`,
    general: `Hey {{first_name}}, it's been a while. I started an agency that builds automated systems for service businesses, proved it out by rebuilding the entire backend of my own cleaning company first.\n\nI'm giving away 5 free case-study builds right now in exchange for feedback + a review. Know any service business owner who'd want that?`,
  };
  const templateText = templates[variant].replace('{{first_name}}', contact.full_name.split(' ')[0] ?? contact.full_name);

  try {
    const { data: org } = await service.from('organizations').select('name').eq('id', contact.org_id).maybeSingle();
    const draft = await draftEmailClaude({
      subject: 'LinkedIn DM', body: templateText,
      lead: { full_name: contact.full_name, context_signal: contact.context_signal },
      notes: [], contractorName, orgName: org?.name ?? 'our team',
      apiKey, model: 'claude-sonnet-5',
    });

    const { data: inserted, error: insertErr } = await service.from('linkedin_drafts').insert({
      contact_id: contactId, org_id: contact.org_id, message: draft.body, template_variant: variant, status: 'draft',
    }).select('id').single();
    if (insertErr) return json({ error: insertErr.message }, 500, headers);

    await service.from('linkedin_contacts').update({ status: 'drafted' }).eq('id', contactId);
    return json({ draft_id: inserted.id, message: draft.body }, 200, headers);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500, headers);
  }
});
