import { expect, it } from 'vitest';
import { websiteSuspicion } from '../../supabase/functions/_shared/domainDiscovery';

const page = (phone: string) => [`<title>UX Tree</title><p>${phone}</p>`];
it('uses an Irish website normally when country is Ireland', () => {
  expect(websiteSuspicion(page('+353 1 234 5678'), ['UX Tree'], 'IE').suspect).toBe(false);
  expect(websiteSuspicion(page('087 123 4567'), ['UX Tree'], 'IE').suspect).toBe(false);
});
it('accepts US phones for US leads, and omits phone suspicion for OTHER', () => {
  expect(websiteSuspicion(page('+1 (212) 555-1234'), ['UX Tree'], 'US').suspect).toBe(false);
  expect(websiteSuspicion(page('+33 1 234 5678'), ['UX Tree'], 'OTHER').suspect).toBe(false);
});
it('keeps title mismatch checks for all countries', () => {
  expect(websiteSuspicion(page('+353 1 234 5678'), ['Another Business'], 'IE').reasons).toContain('The website title and footer name a different business.');
});
it('keeps null and GB behaviour identical to the existing default', () => {
  for (const phone of ['+33 1 234 5678', '+44 20 1234 5678', '+353 1 234 5678', '020 1234 5678']) {
    expect(websiteSuspicion(page(phone), ['UX Tree'], null)).toEqual(websiteSuspicion(page(phone), ['UX Tree']));
    expect(websiteSuspicion(page(phone), ['UX Tree'], 'GB')).toEqual(websiteSuspicion(page(phone), ['UX Tree']));
  }
  expect(websiteSuspicion(page('+33 1 234 5678'), ['UX Tree']).suspect).toBe(true);
});
