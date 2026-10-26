import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PhoneChip } from '../components/pipeline/PhoneChip';
import { ContactRevealButtons } from '../components/pipeline/ContactRevealButtons';
import { filterLeads } from './leadFilters';
import { filterDialableLeads } from './dialerFilters';
import { flagPhoneBusiness } from './phoneBusiness';
import type { DecisionMakerCandidate, Lead } from '../types';

const lead = { id: 'l', phone: '020 7946 0958', country: 'GB', stage: 'new_lead', additional_phones: [] } as unknown as Lead;
const person = { id: 'c', kind: 'person', first_name: 'Jane', last_name: 'Smith', phone: null, source: 'apollo', apollo_person_id: 'p', phone_status: 'not_requested' } as DecisionMakerCandidate;
const filters = { search: '', stages: [], assignees: [], overdueOnly: false };
it('renders a normalized tel link, honest company label and keyboard-accessible provenance', () => {
  const html = renderToStaticMarkup(createElement(PhoneChip, { value: lead.phone!, country: lead.country,
    metadata: { kind: 'company_line', source: 'own_site', source_url: 'https://acme.test/contact', found_at: '2026-10-26T12:00:00Z' } }));
  expect(html).toContain('href="tel:+442079460958"');
  expect(html).toContain('Company line');
  expect(html).toContain('<summary');
  expect(html).toContain('https://acme.test/contact');
  expect(html).not.toContain('Direct line');
});
it('does not make a dial link for junk', () => {
  expect(renderToStaticMarkup(createElement(PhoneChip, { value: '2023-10-19' }))).not.toContain('tel:');
});
it('requires the organisation key before offering explicit phone reveal and never invokes it during render', () => {
  let reveals = 0;
  const props = { contact: person, lead, busy: false, onReveal: () => { reveals++; }, onAddToLead: () => {} };
  const hidden = renderToStaticMarkup(createElement(ContactRevealButtons, { ...props, apolloConfigured: false }));
  expect(hidden).not.toContain('Reveal phone (uses your Apollo credits)');
  expect(hidden).toContain('own Apollo key');
  const shown = renderToStaticMarkup(createElement(ContactRevealButtons, { ...props, apolloConfigured: true, apolloAllowance: 8 }));
  expect(shown).toContain('Reveal phone (uses your Apollo credits)');
  expect(shown).toContain('8 credits');
  expect(reveals).toBe(0);
});
it('filters phone presence across additional and live contact phones, without mistaking company lines for direct', () => {
  const direct = { ...lead, id: 'direct', phone_contacts: [{ phone: '+442079460958', phone_kind: 'direct', dismissed_at: null }] } as Lead;
  const company = { ...lead, id: 'company', phone_meta: { '+442079460958': { kind: 'company_line', source: 'manual', source_url: null, found_at: null } } } as Lead;
  const extra = { ...lead, id: 'extra', phone: null, additional_phones: ['+35312345678'] };
  const mobile = { ...lead, id: 'mobile', phone: null, phone_contacts: [{ phone: '+447911123456', phone_kind: 'mobile', dismissed_at: null }] } as Lead;
  const dismissed = { ...lead, id: 'dismissed', phone: null, phone_contacts: [{ phone: '+442079460958', phone_kind: 'direct', dismissed_at: 'now' }] } as Lead;
  const rows = [direct, company, extra, dismissed, mobile];
  expect(filterLeads(rows, { ...filters, hasPhone: true }).map(l => l.id)).toEqual(['direct', 'company', 'extra', 'mobile']);
  expect(filterLeads(rows, { ...filters, hasDirectLine: true }).map(l => l.id)).toEqual(['direct', 'mobile']);
});
it('gives Power Dialer E.164 without mutating saved originals and excludes junk', () => {
  const result = filterDialableLeads([lead, { ...lead, phone: '2023-10-19' }], { stages: [], assignedToMeOnly: false, notCalledInDays: 'any' }, undefined);
  expect(result.map(l => l.phone)).toEqual(['+442079460958']);
  expect(lead.phone).toBe('020 7946 0958');
});
it('flags a sole-trader number without erasing its source or other phone metadata', () => {
  const stored = { '+442079460958': { kind: 'direct' as const, source: 'own_site' as const, source_url: 'https://acme.test/team', found_at: null } };
  expect(flagPhoneBusiness('020 7946 0958', 'GB', stored, true)).toEqual({ '+442079460958': { ...stored['+442079460958'], sole_trader: true } });
});
