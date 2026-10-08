import { describe, expect, it } from 'vitest';
import { CHOICE_REGEX_SOURCES as autopilotSources, pickRecipient } from '../../supabase/functions/_shared/autopilotChoices';
import { CHOICE_REGEX_SOURCES as contactSources, mainContact, type Contact } from '../../supabase/functions/_shared/contacts';

// Drift guard: `pickRecipient` (autopilot) and `mainContact` (UI, composer) keep separate
// copies of the ranking rules. They must always choose the same recipient.
// Intended difference: only the input shape (`pickRecipient` takes loose candidates with
// `candidateId`, `mainContact` takes Contacts with `contactId`); the answer is identical.

const TITLES: (string | null)[] = ['Owner', 'Managing Director', 'Director', 'Head of Sales', 'Assistant Manager', 'Clerk', null];
const EMAILS: (string | null)[] = ['a@x.com', 'not-an-email', null];
const LEAD_EMAILS: (string | null)[] = ['lead@x.com', ' LEAD@X.com ', 'bad', null];

function build(): Contact[] {
  const out: Contact[] = [];
  for (const kind of ['person', 'general'] as const)
    for (const title of TITLES)
      for (const is_primary of [false, true])
        for (const legacy of [false, true])
          for (const email of EMAILS)
            for (const dismissed of [false, true]) {
              if (kind === 'person' && legacy) continue;
              if (kind === 'general' && title !== null && title !== 'Owner') continue; // titles are meaningless for inboxes
              const id = `${out.length}`;
              out.push({
                id,
                kind,
                first_name: kind === 'person' ? 'N' : null,
                last_name: null,
                title,
                label: legacy ? 'Additional email' : kind === 'general' ? 'Accounts' : null,
                email: email === 'a@x.com' ? `c${id}@x.com` : email,
                phone: null,
                is_primary,
                include_in_sequences: true,
                dismissed_at: dismissed ? '2026-10-01T00:00:00Z' : null,
              });
            }
  return out;
}

const toCandidate = (c: Contact) => ({
  id: c.id,
  kind: c.kind,
  title: c.title,
  email: c.email,
  label: c.label,
  is_primary: c.is_primary,
  include_in_sequences: c.include_in_sequences,
  dismissed_at: c.dismissed_at,
  ...(c.source ? { source: c.source } : {}),
});

const agree = (contacts: Contact[], lead: string | null) => {
  const main = mainContact(contacts, lead);
  const picked = pickRecipient(lead, contacts.map(toCandidate));
  expect(picked).toEqual(main ? { email: main.email, candidateId: main.contactId } : null);
};

describe('pickRecipient and mainContact agree', () => {
  const all = build();

  it('for every single contact and several lead emails', () => {
    expect(all.length).toBeGreaterThan(100);
    for (const c of all) for (const lead of LEAD_EMAILS) agree([c], lead);
  });

  it('for every ordered pair of contacts and several lead emails', () => {
    // Keep pair count modest: every contact against a spread of partners in both orders.
    const partners = all.filter((_, i) => i % 7 === 0);
    for (const a of all)
      for (const b of partners) {
        if (a.id === b.id) continue;
        for (const lead of LEAD_EMAILS) {
          agree([a, b], lead);
          agree([b, a], lead);
        }
      }
  });

  it('for manual general rows that are excluded from sequences', () => {
    const rows: Contact[] = [
      { ...all.find((c) => c.kind === 'general' && !c.is_primary && c.email && c.email.includes('@') && !c.dismissed_at && c.label === 'Accounts')!, id: 'm', source: 'manual', include_in_sequences: false },
    ];
    for (const lead of LEAD_EMAILS) agree(rows, lead);
  });

  it('share identical regex sources and flags', () => {
    expect(contactSources).toEqual(autopilotSources);
    expect(Object.keys(contactSources).sort()).toEqual(['demoted', 'plausibleEmail', 'tier1', 'tier2', 'tier3']);
  });
});
