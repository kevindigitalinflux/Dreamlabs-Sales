import { describe, expect, it } from 'vitest';
import { companyDomainsLine, deepFindProgress, parseCap, readDeepFindDetails } from './deepFindView';

describe('readDeepFindDetails', () => {
  it('reads the engine JSON and drops anything odd', () => {
    expect(readDeepFindDetails({
      domains: [{ domain: 'loveliving.uk', sources: ['hunter_name'], needs_check: false }, { domain: 'x.com', needs_check: true }, 5, { domain: '' }],
      named_by_web: [{ name: 'David Cox', role: 'Owner' }, { role: 'no name' }],
      named_on_site: 'nope',
      unverified_people: [{ name: 'Tom Reed', role: 'Director', email: 'tom@x.com' }],
    })).toEqual({
      domains: [{ domain: 'loveliving.uk', needs_check: false }, { domain: 'x.com', needs_check: true }],
      namedByWeb: [{ name: 'David Cox', role: 'Owner' }],
      namedOnSite: [],
      unverified: [{ name: 'Tom Reed', role: 'Director' }],
      companyCandidates: [], companyNumber: null, steps: [], people: [], websiteSuspect: false, websiteReasons: [],
    });
    expect(readDeepFindDetails(null)).toEqual({
      domains: [], namedByWeb: [], namedOnSite: [], unverified: [], companyCandidates: [], companyNumber: null, steps: [], people: [], websiteSuspect: false, websiteReasons: [],
    });
  });
});

describe('companyDomainsLine', () => {
  it('lists saved domains or nothing', () => {
    expect(companyDomainsLine(['loveliving.uk'])).toBe('Company domains: loveliving.uk (found automatically, check before emailing)');
    expect(companyDomainsLine([])).toBe(null);
    expect(companyDomainsLine(undefined)).toBe(null);
  });
});

describe('deepFindProgress', () => {
  it('counts finished rows and people', () => {
    expect(deepFindProgress([
      { status: 'done', people_found: 3 }, { status: 'running', people_found: 0 }, { status: 'skipped', people_found: 0 },
    ])).toEqual({ done: 2, total: 3, people: 3, working: true });
  });
});

describe('parseCap', () => {
  it('accepts whole numbers inside the limit only', () => {
    expect(parseCap('60', 500)).toBe(60);
    expect(parseCap('0', 500)).toBe(0);
    expect(parseCap('501', 500)).toBe(null);
    expect(parseCap('2.5', 500)).toBe(null);
    expect(parseCap('', 500)).toBe(null);
  });
});

describe('readDeepFindDetails company choice', () => {
  it('reads valid candidates only while no company is settled', () => {
    const d = readDeepFindDetails({
      company_candidates: [
        { company_number: '01111111', name: 'LOVE LIVING MANAGEMENT LIMITED', address: 'Hackney', status: 'active', score: 90 },
        { company_number: 'bad', name: 'X' },
      ],
      steps: ['Companies House: 2 possible companies, please choose.', 5],
      people: [{ name: 'Max Whatley', role: 'Director', source: 'officer', email_found: true }],
    });
    expect(d.companyCandidates).toEqual([{ company_number: '01111111', name: 'LOVE LIVING MANAGEMENT LIMITED', address: 'Hackney', status: 'active' }]);
    expect(d.steps).toEqual(['Companies House: 2 possible companies, please choose.']);
    expect(d.people).toEqual([{ name: 'Max Whatley', role: 'Director', source: 'officer', email_found: true }]);
    expect(readDeepFindDetails({ website_suspect: true, website_reasons: ['The phone numbers on the website are not UK numbers.', 7] }))
      .toMatchObject({ websiteSuspect: true, websiteReasons: ['The phone numbers on the website are not UK numbers.'] });
    expect(readDeepFindDetails({ company_number: '01111111', company_candidates: [{ company_number: '02222222', name: 'Y' }] }).companyCandidates).toEqual([]);
  });
});
