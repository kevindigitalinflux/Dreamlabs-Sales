import { expect, it } from 'vitest';
import { ownBlockedDomains, planUnblock } from './domainBlock';

it('finds blocked domains that are the lead own website or email domain', () => {
  expect(ownBlockedDomains({ website: 'https://www.Acme.com/about', email: 'a@acme.com', blocked_domains: ['acme.com', 'x.com'] })).toEqual([{ domain: 'acme.com', kind: 'website' }]);
  expect(ownBlockedDomains({ website: 'other.com', email: 'a@acme.co.uk', blocked_domains: ['acme.co.uk'] })).toEqual([{ domain: 'acme.co.uk', kind: 'email' }]);
  expect(ownBlockedDomains({ website: 'other.com', blocked_domains: ['x.com'] })).toEqual([]);
  expect(ownBlockedDomains({ blocked_domains: null })).toEqual([]);
});
it('plans an unblock, restoring to email_domains only when asked', () => {
  expect(planUnblock({ blocked: ['a.com', 'b.com'], email: ['c.com'] }, 'a.com', true)).toEqual({ blocked: ['b.com'], email: ['c.com', 'a.com'] });
  expect(planUnblock({ blocked: ['a.com'], email: [] }, 'a.com', false)).toEqual({ blocked: [], email: [] });
  expect(planUnblock({ blocked: ['a.com'], email: ['a.com'] }, 'a.com', true).email).toEqual(['a.com']);
});
