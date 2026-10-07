import { describe, expect, it } from 'vitest';
import {
  canCreatorViewLead, canSendNow, chooseTemplate, fillBlankPatch, followUpNote, isRecipientBlocked, nextEnrollmentState,
  placeholderReason, plainReason, recipientVarOverrides, senderFirstName, unfilledPlaceholderNames,
} from '../../supabase/functions/_shared/selectedLeadPipelineRules';
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
  it('keeps the lead owner name when the candidate last name is obfuscated', () => {
    expect(recipientVarOverrides({ first_name: 'Sam', last_name: 'L***', name_obfuscated: true })).toEqual({ first_name: 'Sam' });
  });
  it('overrides nothing when there is no candidate', () => {
    expect(recipientVarOverrides(null)).toEqual({});
  });
  it('overrides nothing when the candidate has no first name', () => {
    expect(recipientVarOverrides({ first_name: ' ', last_name: null, name_obfuscated: false })).toEqual({});
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
