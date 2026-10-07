import { describe, expect, it } from 'vitest';
import {
  canCreatorViewLead, canSendNow, chooseTemplate, fillBlankPatch, followUpNote, isRecipientBlocked, nextEnrollmentState,
  placeholderReason, plainReason, recipientVarOverrides, senderFirstName, unfilledPlaceholderNames, recipientLabel, unexpectedLinksOrAddresses,
  withUnsubscribeLine, isUsableUnsubscribeUrl, hasStrayPlaceholder, emailMatchesWebsiteDomain, canSendToFoundEmail, firstSendBlock, sameEnrolment,
} from '../../supabase/functions/_shared/selectedLeadPipelineRules';
import { publicAppUrl } from '../../supabase/functions/_shared/appUrl';
import { replySenderMatches } from '../../supabase/functions/_shared/replyMatch';
import { RESEARCH_FALLBACK_NOTE, formatResearchNote, isEmptyResearch } from '../../supabase/functions/_shared/researchPages';

const now = new Date('2026-10-07T10:00:00.000Z');
const steps = [
  { delay_days: 0, template_type: 'cold_outreach_1', template_id: null, subject_override: null },
  { delay_days: 3, template_type: 'cold_outreach_2', template_id: null, subject_override: null },
];

describe('nextEnrollmentState', () => {
  it('moves to the next step with a delay from now', () => {
    expect(nextEnrollmentState(1, steps, now)).toEqual({ current_step: 2, next_send_at: '2026-10-10T10:00:00.000Z', status: 'active' });
  });
  it('completes after the last step and keeps the step number', () => {
    expect(nextEnrollmentState(2, steps, now)).toEqual({ current_step: 2, next_send_at: null, status: 'completed' });
  });
});

describe('followUpNote', () => {
  it('names the next step and total', () => { expect(followUpNote(2, 3)).toBe('Follow up: sequence step 2 of 3'); });
});

describe('isEmptyResearch', () => {
  it('is empty for blank summaries', () => {
    expect(isEmptyResearch({ summary: '' })).toBe(true);
    expect(isEmptyResearch({ summary: '  \n' })).toBe(true);
  });
  it('is empty for the fallback note', () => {
    expect(isEmptyResearch({ summary: formatResearchNote({ website: RESEARCH_FALLBACK_NOTE, web: null, sources: ['https://a.co'] }) })).toBe(true);
  });
  it('is not empty for real bullets', () => {
    expect(isEmptyResearch({ summary: formatResearchNote({ website: '- Runs three sites', web: null, sources: [] }) })).toBe(false);
  });
});

describe('recipientVarOverrides', () => {
  it('uses the chosen candidate first name and full name', () => {
    expect(recipientVarOverrides({ first_name: ' Sam ', last_name: 'Lee', name_obfuscated: false })).toEqual({ first_name: 'Sam', owner_name: 'Sam Lee' });
  });
  it('uses only the first name when the candidate last name is obfuscated', () => {
    expect(recipientVarOverrides({ first_name: 'Sam', last_name: 'L***', name_obfuscated: true })).toEqual({ first_name: 'Sam', owner_name: 'Sam' });
  });
  it('overrides nothing when there is no candidate', () => {
    expect(recipientVarOverrides(null)).toEqual({});
  });
  it('blanks first and owner name when the candidate has no first name, so the draft parks', () => {
    expect(recipientVarOverrides({ first_name: ' ', last_name: null, name_obfuscated: false })).toEqual({ first_name: '', owner_name: '' });
  });
});

describe('recipientLabel', () => {
  it('uses the candidate name and title', () => {
    expect(recipientLabel({ first_name: 'Sam', last_name: 'Lee', name_obfuscated: false, title: 'Director' }, 'Pat Jones')).toEqual({ name: 'Sam Lee', title: 'Director' });
  });
  it('falls back to the lead owner without a candidate, title unknown', () => {
    expect(recipientLabel(null, ' Pat Jones ')).toEqual({ name: 'Pat Jones', title: null });
    expect(recipientLabel(null, null)).toEqual({ name: null, title: null });
  });
  it('never falls back to the lead owner when a candidate has no name', () => {
    expect(recipientLabel({ first_name: null, last_name: null, name_obfuscated: false, title: null }, 'Pat Jones')).toEqual({ name: null, title: null });
  });
});

describe('unexpectedLinksOrAddresses', () => {
  const tpl = 'Hi Sam, see https://acme.co/price. Reply to sales@acme.co';
  it('accepts links and addresses from the template, allowed list and trailing punctuation', () => {
    expect(unexpectedLinksOrAddresses(tpl, 'Hello, see https://acme.co/price, or sales@acme.co. Opt out: https://app.example.com/unsubscribe/abc.', ['https://app.example.com/unsubscribe/abc'])).toEqual([]);
  });
  it('flags a new link and a new address', () => {
    expect(unexpectedLinksOrAddresses(tpl, 'Visit https://evil.test/x or mail bob@evil.test', [])).toEqual(['https://evil.test/x', 'bob@evil.test']);
  });
  it('treats a different path as unexpected', () => {
    expect(unexpectedLinksOrAddresses(tpl, 'see https://acme.co/other', [])).toEqual(['https://acme.co/other']);
  });
  it('does not count the email inside an allowed URL separately', () => {
    expect(unexpectedLinksOrAddresses('x', 'go https://a.co/u?e=a@b.co', ['https://a.co/u?e=a@b.co'])).toEqual([]);
  });
});

describe('withUnsubscribeLine and isUsableUnsubscribeUrl', () => {
  const url = 'https://sales.example.com/unsubscribe/abc';
  it('appends the opt out line when missing', () => {
    expect(withUnsubscribeLine('Body\n', url)).toBe(`Body\n\nIf you would rather not hear from me again, you can opt out here: ${url}`);
  });
  it('leaves a body that already has the link', () => {
    expect(withUnsubscribeLine(`Body ${url}`, url)).toBe(`Body ${url}`);
  });
  it('only accepts https unsubscribe links', () => {
    expect(isUsableUnsubscribeUrl(url)).toBe(true);
    expect(isUsableUnsubscribeUrl('http://localhost:5173/unsubscribe/abc')).toBe(false);
    expect(isUsableUnsubscribeUrl('https://x.com/other')).toBe(false);
  });
});

describe('hasStrayPlaceholder', () => {
  it('flags bracket and single brace placeholders', () => {
    expect(hasStrayPlaceholder('Hi [First Name]')).toBe(true);
    expect(hasStrayPlaceholder('Hi {name}')).toBe(true);
    expect(hasStrayPlaceholder('Hi {{name}}')).toBe(false);
    expect(hasStrayPlaceholder('Hi Sam, see [1] and (note)')).toBe(false);
  });
});

describe('emailMatchesWebsiteDomain', () => {
  it('matches www, subdomains and bare domains', () => {
    expect(emailMatchesWebsiteDomain('a@acme.com', 'https://www.acme.com/about')).toBe(true);
    expect(emailMatchesWebsiteDomain('a@mail.acme.com', 'acme.com')).toBe(true);
  });
  it('handles co.uk style suffixes', () => {
    expect(emailMatchesWebsiteDomain('a@acme.co.uk', 'www.acme.co.uk')).toBe(true);
    expect(emailMatchesWebsiteDomain('a@other.co.uk', 'acme.co.uk')).toBe(false);
  });
  it('rejects free mail, other companies and a missing website', () => {
    expect(emailMatchesWebsiteDomain('acme@gmail.com', 'acme.com')).toBe(false);
    expect(emailMatchesWebsiteDomain('a@acme.com', null)).toBe(false);
    expect(emailMatchesWebsiteDomain('a@acme.com', '  ')).toBe(false);
  });
});

describe('canSendToFoundEmail', () => {
  const base = { email: 'a@acme.com', website: 'acme.com', websiteWasOnLead: true, websiteSource: undefined };
  it('allows a matching domain on a website the lead already had', () => { expect(canSendToFoundEmail(base)).toBe(true); });
  it('rejects a website found only by Google Places', () => {
    expect(canSendToFoundEmail({ ...base, websiteWasOnLead: false, websiteSource: 'google_places' })).toBe(false);
  });
  it('allows a newly found website from another source', () => {
    expect(canSendToFoundEmail({ ...base, websiteWasOnLead: false, websiteSource: 'hunter' })).toBe(true);
  });
  it('rejects a domain mismatch', () => { expect(canSendToFoundEmail({ ...base, email: 'a@other.com' })).toBe(false); });
});

describe('firstSendBlock and sameEnrolment', () => {
  const ok = { leadFound: true, sameOrg: true, ineligibleReason: null, recipientBlocked: false, enrolmentChanged: false, recentlyEmailed: false, optedOutLeadHasAddress: false, candidateRemoved: false };
  const reasonFor = (c: string) => `code:${c}`;
  it('passes when everything is fine', () => { expect(firstSendBlock(ok, reasonFor)).toBeNull(); });
  it('reports the highest priority failure first', () => {
    expect(firstSendBlock({ ...ok, ineligibleReason: 'opted_out', recentlyEmailed: true }, reasonFor)).toBe('code:opted_out');
    expect(firstSendBlock({ ...ok, recipientBlocked: true, recentlyEmailed: true }, reasonFor)).toBe('code:blocked');
    expect(firstSendBlock({ ...ok, recentlyEmailed: true, candidateRemoved: true }, reasonFor)).toBe('This address was emailed in the last 14 days');
    expect(firstSendBlock({ ...ok, leadFound: false, sameOrg: false }, reasonFor)).toBe('Lead no longer exists');
  });
  it('compares enrolments by id and step', () => {
    expect(sameEnrolment(null, null)).toBe(true);
    expect(sameEnrolment({ id: 'e', current_step: 2 }, { id: 'e', current_step: 2 })).toBe(true);
    expect(sameEnrolment({ id: 'e', current_step: 2 }, { id: 'e', current_step: 3 })).toBe(false);
    expect(sameEnrolment(null, { id: 'e', current_step: 1 })).toBe(false);
  });
});

describe('publicAppUrl', () => {
  it('prefers APP_PUBLIC_URL and trims slashes', () => {
    expect(publicAppUrl('https://sales.example.com/', 'http://localhost:5173,https://x.com')).toBe('https://sales.example.com');
  });
  it('else the first https origin, else the first origin', () => {
    expect(publicAppUrl(undefined, 'http://localhost:5173, https://sales.example.com ,https://b.com')).toBe('https://sales.example.com');
    expect(publicAppUrl('', 'http://localhost:5173')).toBe('http://localhost:5173');
    expect(publicAppUrl(null, null)).toBe('http://localhost:5173');
  });
});

describe('replySenderMatches', () => {
  it('matches the emailed address or the lead email, ignoring case', () => {
    expect(replySenderMatches('Sam@Acme.com', 'sam@acme.com', 'info@acme.com')).toBe(true);
    expect(replySenderMatches('info@acme.com', 'sam@acme.com', 'INFO@acme.com')).toBe(true);
  });
  it('rejects others and empty values', () => {
    expect(replySenderMatches('x@evil.com', 'sam@acme.com', 'info@acme.com')).toBe(false);
    expect(replySenderMatches('', '', '')).toBe(false);
    expect(replySenderMatches('a@b.co', null, undefined)).toBe(false);
  });
});

describe('canSendNow', () => {
  it('is true before the deadline', () => { expect(canSendNow({ deadlineMs: 2000, nowMs: 1000, sendStarted: false })).toBe(true); });
  it('is false after the deadline when the send has not started', () => { expect(canSendNow({ deadlineMs: 1000, nowMs: 2000, sendStarted: false })).toBe(false); });
  it('is always true once the send started', () => { expect(canSendNow({ deadlineMs: 1000, nowMs: 2000, sendStarted: true })).toBe(true); });
});

describe('placeholders', () => {
  it('lists names from missing variables and leftover braces once each', () => {
    expect(unfilledPlaceholderNames('Hi {{first_name}}', 'x {{ first_name }} {{a.b}}', ['pain_point'])).toEqual(['pain_point', 'first_name', 'a.b']);
  });
  it('flags stray braces even without a clean name', () => {
    expect(unfilledPlaceholderNames('Hi', 'Oops {{ }}', [])).toEqual(['unknown']);
  });
  it('is empty for clean text', () => { expect(unfilledPlaceholderNames('Hi', 'Body', [])).toEqual([]); });
  it('formats the reason', () => {
    expect(placeholderReason(['a', 'b'])).toBe('Draft has an unfilled placeholder: {{a}}, {{b}}');
  });
});

describe('senderFirstName', () => {
  it('takes the first word of the full name', () => { expect(senderFirstName('  Kevin Smith ')).toBe('Kevin'); });
  it('is null for blank or missing', () => { expect(senderFirstName('')).toBeNull(); expect(senderFirstName(null)).toBeNull(); });
});

describe('isRecipientBlocked', () => {
  it('matches email or domain case-insensitively', () => {
    expect(isRecipientBlocked('A@Acme.com', new Set(['a@acme.com']))).toBe(true);
    expect(isRecipientBlocked('a@acme.com', new Set([' ACME.com ']))).toBe(true);
    expect(isRecipientBlocked('a@acme.com', new Set(['other.com']))).toBe(false);
  });
});

describe('chooseTemplate', () => {
  const t = (id: string, org_id: string | null, template_type: string, is_default = true) => ({ id, org_id, template_type, is_default });
  const list = [t('g1', null, 'cold_outreach_1'), t('o1', 'org', 'cold_outreach_1'), t('c1', 'org', 'custom', false), t('x1', 'other', 'cold_outreach_1')];
  it('prefers the org default over the global one', () => {
    expect(chooseTemplate(list, { template_type: 'cold_outreach_1' }, 'org')?.id).toBe('o1');
  });
  it('falls back to the global default', () => {
    expect(chooseTemplate(list, { template_type: 'cold_outreach_1' }, 'new')?.id).toBe('g1');
  });
  it('finds a named template by id within org or global only', () => {
    expect(chooseTemplate(list, { template_type: 'custom', template_id: 'c1' }, 'org')?.id).toBe('c1');
    expect(chooseTemplate(list, { template_type: 'custom', template_id: 'x1' }, 'org')).toBeNull();
    expect(chooseTemplate(list, { template_type: 'custom', template_id: 'gone' }, 'org')).toBeNull();
  });
  it('returns null when there is no default for the type', () => {
    expect(chooseTemplate(list, { template_type: 'follow_up' }, 'org')).toBeNull();
  });
});

describe('canCreatorViewLead', () => {
  const base = { memberRole: 'member' as string | null, pipeline: { is_default: true, created_by: null as string | null }, leadCreatedBy: null as string | null, leadAssignedTo: null as string | null, shared: false, creatorId: 'u1' };
  it('is false for a non member', () => { expect(canCreatorViewLead({ ...base, memberRole: null })).toBe(false); });
  it('is true for an admin', () => { expect(canCreatorViewLead({ ...base, memberRole: 'admin', leadCreatedBy: 'other' })).toBe(true); });
  it('default pipeline: needs system, own or assigned lead', () => {
    expect(canCreatorViewLead(base)).toBe(true);
    expect(canCreatorViewLead({ ...base, leadCreatedBy: 'u1' })).toBe(true);
    expect(canCreatorViewLead({ ...base, leadAssignedTo: 'u1', leadCreatedBy: 'x' })).toBe(true);
    expect(canCreatorViewLead({ ...base, leadCreatedBy: 'x' })).toBe(false);
  });
  it('named pipeline: owner or share', () => {
    const named = { ...base, pipeline: { is_default: false, created_by: 'x' }, leadCreatedBy: 'x' };
    expect(canCreatorViewLead(named)).toBe(false);
    expect(canCreatorViewLead({ ...named, shared: true })).toBe(true);
    expect(canCreatorViewLead({ ...named, pipeline: { is_default: false, created_by: 'u1' } })).toBe(true);
  });
});

describe('fillBlankPatch', () => {
  it('fills only blank fields', () => {
    expect(fillBlankPatch({ email: null, phone: '  ', owner_name: 'Pat', website: '—' }, { email: 'a@b.co', phone: '0123', owner_name: 'Zed', website: 'x.co' }))
      .toEqual({ email: 'a@b.co', phone: '0123', website: 'x.co' });
  });
  it('ignores unknown or empty found values', () => {
    expect(fillBlankPatch({ email: null }, { email: ' ', foo: 'x' })).toEqual({});
  });
});

describe('plainReason', () => {
  it('removes web addresses, dashes and arrows', () => {
    expect(plainReason('Set up your email in Settings → Email sending — then retry')).toBe('Set up your email in Settings to Email sending, then retry');
    expect(plainReason('error sending request for url (https://x.example/a?key=SECRET123)')).toBe('error sending request for url (a web address');
  });
  it('truncates and falls back', () => {
    expect(plainReason('a'.repeat(500))).toHaveLength(300);
    expect(plainReason('   ')).toBe('Unexpected error');
  });
});
