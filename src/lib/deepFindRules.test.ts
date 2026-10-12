import { describe, expect, it } from 'vitest';
import {
  deepFindSummary, emailOnLead, extractTeamMembers, findSamePerson, hunterPeople, namedPersonIsStored, parseCreateRequest,
  stuckAction, type LeadStats,
} from '../../supabase/functions/_shared/deepFindRules';
import { cleanEmail, cleanLinkedinProfile } from '../../supabase/functions/_shared/knownPersonWide';
import { pickRegisteredCompany } from '../../supabase/functions/_shared/companiesHouse';

const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const ID2 = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

describe('parseCreateRequest', () => {
  it('accepts up to 25 distinct ids and defaults the caps', () => {
    expect(parseCreateRequest({ lead_ids: [ID, ID.toUpperCase(), ID2] })).toEqual({ ok: true, leadIds: [ID, ID2], caps: { hunter: 60, ai: 25 } });
    expect(parseCreateRequest({ lead_ids: [ID], caps: { hunter: 0, ai: 3 } })).toEqual({ ok: true, leadIds: [ID], caps: { hunter: 0, ai: 3 } });
  });
  it('refuses bad input', () => {
    expect(parseCreateRequest({ lead_ids: [] })).toMatchObject({ ok: false });
    expect(parseCreateRequest({ lead_ids: Array.from({ length: 26 }, () => ID) })).toMatchObject({ ok: false });
    expect(parseCreateRequest({ lead_ids: ['1 OR 1=1'] })).toEqual({ ok: false, error: 'Invalid lead id' });
    expect(parseCreateRequest({ lead_ids: [ID], caps: { hunter: 501 } })).toMatchObject({ ok: false });
    expect(parseCreateRequest({ lead_ids: [ID], caps: { ai: 2.5 } })).toMatchObject({ ok: false });
    expect(parseCreateRequest(null)).toMatchObject({ ok: false });
  });
});

describe('hunterPeople', () => {
  it('keeps named people with a role on the exact domain, not shared mailboxes or odd shapes', () => {
    const emails = [
      { value: 'David.Cox@loveliving.uk', first_name: 'David', last_name: 'Cox', position: 'Managing Director', linkedin: 'https://linkedin.com/in/dcox', seniority: 'executive' },
      { value: 'info@loveliving.uk', first_name: 'Info', last_name: 'Desk', position: 'Office' },
      { value: 'amy@loveliving.uk', first_name: 'Amy', last_name: null, position: 'Negotiator' },
      { value: 'tom@other.com', first_name: 'Tom', last_name: 'Reed', position: 'Director' },
      { value: 'sara@loveliving.uk', first_name: 'Sara', last_name: 'Cox', position: '' },
      { value: 'x@loveliving.uk', first_name: '<img src=x>', last_name: 'Y', position: 'Director' },
      'nope', null,
    ];
    expect(hunterPeople(emails, 'loveliving.uk', cleanEmail, cleanLinkedinProfile)).toEqual([{
      first_name: 'David', last_name: 'Cox', title: 'Managing Director', email: 'david.cox@loveliving.uk',
      linkedin_url: 'https://www.linkedin.com/in/dcox', seniority: 'executive',
    }]);
    expect(hunterPeople('nope', 'x.com', cleanEmail, cleanLinkedinProfile)).toEqual([]);
  });
});

describe('de-duplication (Review Focus 3)', () => {
  const rows = [
    { id: '1', kind: 'person', first_name: 'David', last_name: 'COX', email: null },
    { id: '2', kind: 'person', first_name: 'Sara', last_name: 'Smith', email: 'Sara@LoveLiving.uk', dismissed_at: '2026-01-01' },
    { id: '3', kind: 'general', label: 'Reception', email: 'info@loveliving.uk' },
  ];
  it('matches the same person across sources, case and first-name forms', () => {
    expect(findSamePerson(rows, 'Dave', 'Cox')).toBe(null); // not an initial or a prefix: never guessed
    expect(findSamePerson(rows, 'D', 'cox')?.id).toBe('1');
    expect(findSamePerson(rows, 'David', 'Cox')?.id).toBe('1');
    expect(findSamePerson(rows, 'Sara', 'Smith')?.id).toBe('2'); // dismissed rows count: never re-added
    expect(findSamePerson([...rows, { id: '4', kind: 'person', first_name: 'D', last_name: 'Cox' }], 'David', 'Cox')).toBe(null);
  });
  it('sees an email already on the lead in any case', () => {
    expect(emailOnLead(rows, 'sara@loveliving.uk')).toBe(true);
    expect(emailOnLead(rows, 'new@loveliving.uk')).toBe(false);
  });
  it('knows when a named person is already a contact', () => {
    expect(namedPersonIsStored('David Cox', rows)).toBe(true);
    expect(namedPersonIsStored('Peter Cox', rows)).toBe(false);
  });
});

describe('extractTeamMembers', () => {
  it('reads JSON-LD people and "Name, Role" text, ignoring menus', () => {
    const html = `
      <script type="application/ld+json">{"@graph":[{"@type":"Person","name":"Jane Doe","jobTitle":"Founder"}]}</script>
      <h3>David Cox</h3><p>Managing Director</p>
      <li>Contact Us</li><li>Office Manager</li>
      <p>Amy Jones, Lettings Negotiator</p>`;
    expect(extractTeamMembers(html)).toEqual([
      { name: 'Jane Doe', role: 'Founder' },
      { name: 'David Cox', role: 'Managing Director' },
    ]);
    expect(extractTeamMembers(5)).toEqual([]);
  });
});

describe('deepFindSummary', () => {
  const base: LeadStats = {
    hunterPeople: 0, officersAdded: 0, officerEmails: 0, domainsShown: [], domainsToCheck: 0, namedByWeb: 0, namedOnSite: 0,
    hunterCapHit: false, aiCapHit: false, noHunterKey: false, noWebsite: false, failures: 0, unverifiedPeople: 0,
  };
  it('says what was found in plain English', () => {
    expect(deepFindSummary({ ...base, hunterPeople: 3, officersAdded: 1, domainsShown: ['loveliving.uk'], namedByWeb: 2, hunterCapHit: true }))
      .toBe('Found 4 new people (3 from Hunter, 1 from Companies House). Company domains: loveliving.uk. The web search named 2 people not confirmed elsewhere: see suggestions. The Hunter credit cap was reached, so some searches were skipped. New people are not added to follow-up sequences until you switch them on.');
    expect(deepFindSummary(base)).toBe('No new people found. New people are not added to follow-up sequences until you switch them on.');
  });
  it('mentions people on an unconfirmed domain', () => {
    expect(deepFindSummary({ ...base, unverifiedPeople: 2 })).toContain("Hunter lists 2 people on a domain that could not be confirmed as this company's: see suggestions.");
  });
  it('never puts unsafe characters into the sentence', () => {
    expect(deepFindSummary({ ...base, domainsShown: ['<b>x.com'] })).toContain('Company domains: bx.com.');
  });
});

describe('stuckAction', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  it('ignores fresh rows, requeues once, then fails', () => {
    expect(stuckAction({ claimed_at: '2026-10-12T11:55:00Z', attempts: 1 }, now)).toBe('ignore');
    expect(stuckAction({ claimed_at: '2026-10-12T11:40:00Z', attempts: 1 }, now)).toBe('requeue');
    expect(stuckAction({ claimed_at: '2026-10-12T11:40:00Z', attempts: 2 }, now)).toBe('fail');
    expect(stuckAction({ claimed_at: null, attempts: 1 }, now)).toBe('requeue');
  });
});

describe('pickRegisteredCompany', () => {
  const items = [
    { company_number: '01234567', title: 'LOVE LIVING MANAGEMENT LIMITED', company_status: 'active', address: { postal_code: 'LS1 1AA' } },
    { company_number: '07654321', title: 'LOVE LIVING HOMES LTD', company_status: 'active', address: { postal_code: 'M1 1AA' } },
    { company_number: '0999', title: 'LOVE LIVING', company_status: 'dissolved', address: { postal_code: 'LS1 1AA' } },
  ];
  it('needs the same postcode and every brand word', () => {
    expect(pickRegisteredCompany(items, 'Love Living Management', 'ls11aa')).toEqual({ company_number: '01234567', title: 'LOVE LIVING MANAGEMENT LIMITED' });
    expect(pickRegisteredCompany(items, 'Love Living Management', 'SW1A 1AA')).toBe(null);
    expect(pickRegisteredCompany(items, 'Love Living Management', null)).toBe(null);
    expect(pickRegisteredCompany('nope', 'Love Living', 'LS1 1AA')).toBe(null);
  });
  it('picks nothing when two companies fit', () => {
    const two = [...items, { company_number: '05555555', title: 'LOVE LIVING LTD', company_status: 'active', address: { postal_code: 'LS1 1AA' } }];
    expect(pickRegisteredCompany(two, 'Love Living', 'LS1 1AA')).toBe(null);
  });
});
