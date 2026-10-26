import { expect, it, vi } from 'vitest';
import { apolloPhonePatch, resolveOwnApolloKey } from '../../supabase/functions/_shared/apolloPhone';
import { revealApolloPerson } from '../../supabase/functions/_shared/apolloPeopleSearch';
import type { SupabaseClient } from '@supabase/supabase-js';

it('normalizes Apollo phone evidence and prefers a usable business mobile', () => {
  expect(apolloPhonePatch([{ raw_number: '2023-10-19', type_cd: 'mobile' }, { raw_number: '020 7946 0958' }], 'GB', '2026-10-26T12:00:00Z')).toEqual({
    phone: '+442079460958', phone_kind: 'direct', phone_source: 'apollo', phone_source_url: null, phone_found_at: '2026-10-26T12:00:00Z', phone_status: 'revealed',
  });
  expect(apolloPhonePatch([{ raw_number: '07911 123456', type_cd: 'mobile' }], 'GB', 'now')).toMatchObject({ phone: '+447911123456', phone_kind: 'mobile' });
  expect(apolloPhonePatch([{ raw_number: 'nonsense' }], 'GB', 'now')).toEqual({ phone_status: 'not_found' });
});
it('never resolves a global Apollo fallback, even when an environment key could exist', async () => {
  const rpc = vi.fn(async () => ({ data: 'dummy-org-key', error: null }));
  const client = (configured: boolean) => ({ rpc, from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { is_configured: configured }, error: null }) }; return q;
  } }) as unknown as SupabaseClient;
  expect(await resolveOwnApolloKey(client(false), 'org')).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
  expect(await resolveOwnApolloKey(client(true), 'org')).toBe('dummy-org-key');
  expect(rpc).toHaveBeenCalledWith('app_get_org_api_key', { target_org: 'org', target_provider: 'apollo' });
});
it('reveals a known person using only their business identity after an explicit call', async () => {
  let payload: Record<string, unknown> = {};
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    payload = JSON.parse(options.body);
    return Response.json({ person: { first_name: 'Jane', last_name: 'Smith' } });
  }));
  try {
    await revealApolloPerson({ firstName: 'Jane', lastName: 'Smith', domain: 'acme.test' }, 'dummy', { revealEmail: false, revealPhone: true, webhookUrl: 'https://local.test/callback' });
    expect(payload).toEqual({ first_name: 'Jane', last_name: 'Smith', domain: 'acme.test', reveal_phone_number: true, webhook_url: 'https://local.test/callback' });
    expect(payload).not.toHaveProperty('reveal_personal_emails');
  } finally { vi.unstubAllGlobals(); }
});
