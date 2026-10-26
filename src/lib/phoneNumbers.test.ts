import { describe, expect, it } from 'vitest';
import { parsePhone, isPlausiblePhone, phoneMetadata, personPhoneSuggestion } from '../../supabase/functions/_shared/phoneNumbers';

describe('business phone numbers', () => {
  it.each([
    ['020 7946 0958', 'GB', '+442079460958', 'landline'],
    ['07911 123456', 'GB', '+447911123456', 'mobile'],
    ['01 234 5678', 'IE', '+35312345678', 'landline'],
    ['087 123 4567', 'IE', '+353871234567', 'mobile'],
    ['(212) 555-0198', 'US', '+12125550198', 'unknown'],
    ['050 123 4567', 'AE', '+971501234567', 'mobile'],
    ['055 123 4567', 'SA', '+966551234567', 'mobile'],
    ['+44 (0)20 7946 0958', 'IE', '+442079460958', 'landline'],
    ['00353 1 234 5678', 'GB', '+35312345678', 'landline'],
  ])('normalizes %s with country %s', (original, country, value, lineType) => {
    expect(parsePhone(original, country)).toMatchObject({ original, value, lineType });
  });
  it.each(['2010-2024', '2023-10-19', '05-10-2019', '01.02.2023', '1/2/23', 'SW1A 1AA', 'Company No. 12345678',
    '12345678', '00000000000', '+11111111111', '09999999999', '+44 9999999999', '020123', 'abc02079460958', '020 0000000'])('rejects junk %s', value => {
    expect(parsePhone(value, 'GB')).toBeNull();
    expect(isPlausiblePhone(value)).toBe(false);
  });
  it('does not guess a country for an unlisted region', () => {
    expect(parsePhone('02079460958', 'OTHER')).toBeNull();
    expect(parsePhone('+442079460958', 'OTHER')?.value).toBe('+442079460958');
  });
  it('keeps legacy Phase 3 shapes without broadening the automatic gate', () => {
    expect(isPlausiblePhone('07700 900123')).toBe(true);
    expect(isPlausiblePhone('+1 212 555 0198')).toBe(true);
    expect(isPlausiblePhone('2125550198')).toBe(false);
    expect(isPlausiblePhone('0501234567')).toBe(true); // Historical Irish-length shape; the parser still requires a country.
  });
  it('records provenance and keeps the original display text', () => {
    expect(phoneMetadata('020 7946 0958', 'GB', 'company_line', 'places', 'https://acme.test', '2026-10-26T12:00:00Z'))
      .toEqual({ value: '+442079460958', original: '020 7946 0958', kind: 'company_line', source: 'places', source_url: 'https://acme.test/', found_at: '2026-10-26T12:00:00Z' });
  });
});

describe('free person phone suggestions', () => {
  const page = { html: '<article><h2>Jane Smith</h2><p>Director</p><a href="tel:02079460958">Call Jane</a></article>', url: 'https://acme.test/team', source: 'own_site' as const };
  it('offers a direct line only beside the whole name in the same staff block', () => {
    expect(personPhoneSuggestion('Jane Smith', [page], null, 'GB', 'now')).toMatchObject({ name: 'Jane Smith', field: 'person_phone', value: '+442079460958', phone: { kind: 'direct', source: 'own_site', source_url: page.url } });
  });
  it('accepts a business number beside the name in one paragraph', () => {
    expect(personPhoneSuggestion('Jane Smith', [{ ...page, html: '<p>Jane Smith: 020 7946 0958</p>' }], null, 'GB', 'now')?.phone.kind).toBe('direct');
  });
  it('offers the company fallback as a company line', () => {
    expect(personPhoneSuggestion('Jane Smith', [], '020 7946 0958', 'GB', 'now')).toMatchObject({ field: 'person_phone', phone: { kind: 'company_line' }, label: expect.stringContaining('Company line') });
  });
  it('returns nothing when no business phone exists', () => {
    expect(personPhoneSuggestion('Jane Smith', [], null, 'GB', 'now')).toBeNull();
  });
  it.each([
    '<article>Jane Smith</article><footer>02079460958</footer>',
    '<article>Jane Smithson <a href="tel:02079460958">Call</a></article>',
    '<section><article>Jane Smith</article><article>John Jones 02079460958</article></section>',
    '<article>Jane Smith</article><script>02079460958</script>',
  ])('does not attribute an unrelated number to the person', html => {
    expect(personPhoneSuggestion('Jane Smith', [{ ...page, html }], null, 'GB', 'now')).toBeNull();
  });
  it('does not take numbers from a social or aggregator source', () => {
    for (const url of ['https://www.linkedin.com/in/jane', 'https://rocketreach.co/jane', 'https://zoominfo.com/p/jane']) {
      expect(personPhoneSuggestion('Jane Smith', [{ ...page, url }], null, 'GB', 'now')).toBeNull();
    }
  });
});
