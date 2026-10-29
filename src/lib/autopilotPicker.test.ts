import { describe, expect, it } from 'vitest';
import { filterPickerGroups, pickerContactStatus, pickerReason, selectMatching, selectedSummary, hasVerifiedEmail, emptyPickerFilters } from './autopilotPicker';
import { groupSelectableLeads } from './selectableLeads';
import type { PickerLead, SelectableLead } from './selectableLeads';
import type { Lead, Pipeline } from '../types';
const now = new Date('2026-07-07T22:30:00Z'); // 23:30 London, already 8 July in Tokyo.
const row = (id: string, patch: Partial<PickerLead> = {}): PickerLead => ({ id, pipeline_id: 'p', business_name: id,
  owner_name: null, email: null, last_contacted_at: null, next_action_date: null, stage: 'new_lead',
  eligible: true, reason: 'new', enrollment: null, ...patch } as PickerLead);
const groups = (rows: PickerLead[]) => ['p', 'q'].map(pipelineId => ({ pipelineId, pipelineName: pipelineId,
  leads: rows.filter(l => l.pipeline_id === pipelineId), eligible: rows.filter((l): l is PickerLead & SelectableLead => l.pipeline_id === pipelineId && l.eligible && (l.reason === 'new' || l.reason === 'due')), hiddenCount: 0 }));
const ids = (result: ReturnType<typeof filterPickerGroups>) => result.flatMap(g => g.leads.map(l => l.id));

describe('picker filters', () => {
  const rows = [row('a', { business_name: 'Acme   Services', owner_name: 'Alice   Smith', email: 'hello@acme.test', readiness: 'ready', readiness_missing: [] }),
    row('b', { pipeline_id: 'q', business_name: 'Beta', city: 'Acme Services', stage: 'won', readiness: 'almost', eligible: false, reason: 'closed' }),
    row('c', { business_name: 'Gamma' })];
  it.each(['  ACME  services ', 'alice  SMITH', 'HELLO@ACME.TEST'])('normalises search in company, owner and email: %s', search => {
    expect(ids(filterPickerGroups(groups(rows), { ...emptyPickerFilters(), search }, new Set(), now, 'Europe/London'))).toEqual(['a']);
  });
  it('does not search city', () => {
    expect(ids(filterPickerGroups(groups([rows[1]!]), { ...emptyPickerFilters(), search: 'acme' }, new Set(), now, 'Europe/London'))).toEqual([]);
  });
  it('combines pipeline, stage, readiness, verified-email, selection and eligibility filters', () => {
    const filters = { ...emptyPickerFilters(), pipelineIds: ['p'], stages: ['new_lead' as const], readiness: ['ready' as const], verifiedEmail: true, selectedOnly: true, hideIneligible: true };
    expect(ids(filterPickerGroups(groups(rows), filters, new Set(['a', 'b']), now, 'Europe/London'))).toEqual(['a']);
    expect(ids(filterPickerGroups(groups(rows), { ...filters, pipelineIds: [] }, new Set(['a']), now, 'Europe/London'))).toEqual([]);
  });
  it('includes unchecked leads only for the Not checked filter and resets to all rows', () => {
    expect(ids(filterPickerGroups(groups(rows), { ...emptyPickerFilters(), readiness: ['not_checked'] }, new Set(), now, 'Europe/London'))).toEqual(['c']);
    expect(ids(filterPickerGroups(groups(rows), emptyPickerFilters(), new Set(), now, 'Europe/London'))).toEqual(['a', 'c', 'b']);
  });
  it('keeps disabled rows by default and hides them only when requested', () => {
    expect(ids(filterPickerGroups(groups(rows), { ...emptyPickerFilters(), hideIneligible: true }, new Set(), now, 'Europe/London'))).toEqual(['a', 'c']);
  });
});

describe('contact status uses the run day, not the machine day', () => {
  it('treats any non-null last_contacted_at as contacted, independently of stage', () => {
    expect(pickerContactStatus(row('a'), 'never', now, 'Europe/London')).toBe(true);
    expect(pickerContactStatus(row('a', { last_contacted_at: '2020-01-01' }), 'contacted', now, 'Europe/London')).toBe(true);
    expect(pickerContactStatus(row('a', { stage: 'contacted' }), 'contacted', now, 'Europe/London')).toBe(false);
  });
  it('uses active next_send_at through the final millisecond of the run day, before lead next action', () => {
    const active = row('a', { enrollment: { status: 'active', next_send_at: '2026-07-07T22:59:59.999Z' }, next_action_date: '2030-01-01' });
    expect(pickerContactStatus(active, 'due', now, 'Europe/London')).toBe(true);
    const nextDay = { ...active, enrollment: { status: 'active' as const, next_send_at: '2026-07-07T23:00:00Z' }, next_action_date: '2020-01-01' };
    expect(pickerContactStatus(nextDay, 'due', now, 'Europe/London')).toBe(false);
    expect(pickerContactStatus(nextDay, 'not_due', now, 'Europe/London')).toBe(true);
    expect(pickerContactStatus(nextDay, 'due', now, 'Asia/Tokyo')).toBe(true);
  });
  it.each(['2026-07-07', '2026-07-06'])('includes dated follow-ups today or overdue: %s', next_action_date => {
    expect(pickerContactStatus(row('a', { next_action_date }), 'due', now, 'Europe/London')).toBe(true);
  });
  it('does not label an undated lead as due or future; active unscheduled is not due', () => {
    expect(pickerContactStatus(row('a'), 'due', now, 'Europe/London')).toBe(false);
    expect(pickerContactStatus(row('a'), 'not_due', now, 'Europe/London')).toBe(false);
    expect(pickerContactStatus(row('a', { enrollment: { status: 'active', next_send_at: null } }), 'not_due', now, 'Europe/London')).toBe(true);
    expect(pickerContactStatus(row('a', { next_action_date: '2026-07-08' }), 'not_due', now, 'Europe/London')).toBe(true);
  });
  it('filters contact status alongside other filters', () => {
    const data = groups([row('a', { next_action_date: '2026-07-07' }), row('b')]);
    expect(ids(filterPickerGroups(data, { ...emptyPickerFilters(), contact: 'due' }, new Set(), now, 'Europe/London'))).toEqual(['a']);
  });
});

describe('saved verified-email assessment', () => {
  it.each([
    [{ email: 'a@test.invalid' }, false],
    [{ readiness: 'ready', readiness_missing: [], email: 'a@test.invalid' }, true],
    [{ readiness: 'almost', readiness_missing: ['decision_maker'], email: 'a@test.invalid' }, true],
    [{ readiness: 'almost', readiness_missing: ['verified_email'], email: 'a@test.invalid' }, false],
    [{ readiness: 'ready', readiness_missing: null, email: 'a@test.invalid' }, false],
    [{ readiness: 'ready', readiness_missing: [], email: null }, false],
    [{ readiness: 'almost', readiness_missing: ['company_match'], additional_emails: ['a@test.invalid'] }, true],
    [{ readiness: 'almost', readiness_missing: ['company_match'], email_contacts: [{ email: 'a@test.invalid', dismissed_at: null }] }, true],
    [{ readiness: 'ready', readiness_missing: [], email_contacts: [{ email: 'a@test.invalid', dismissed_at: '2026-07-01' }] }, false],
  ] as [Partial<Lead>, boolean][])('requires a checked saved fact and a saved address: %j', (patch, expected) => {
    expect(hasVerifiedEmail(row('a', patch))).toBe(expected);
  });
});

describe('selection across filtered pipelines', () => {
  const all = groups([row('a'), row('b', { pipeline_id: 'q' }), row('x', { eligible: false, reason: 'blocked' })]);
  it('adds only matching eligible ids without mutating or dropping hidden picks', () => {
    const selected = new Set(['b', 'stale']);
    const filtered = filterPickerGroups(all, { ...emptyPickerFilters(), pipelineIds: ['p'] }, selected, now, 'Europe/London');
    expect([...selectMatching(selected, filtered)]).toEqual(['b', 'stale', 'a']);
    expect([...selected]).toEqual(['b', 'stale']);
    expect([...selectMatching(selected, [])]).toEqual(['b', 'stale']);
  });
  it('counts selected pipelines and hidden ids independently of filters', () => {
    const filtered = filterPickerGroups(all, { ...emptyPickerFilters(), pipelineIds: ['p'] }, new Set(['a', 'b']), now, 'Europe/London');
    expect(selectedSummary(new Set(['a', 'b']), all, filtered)).toEqual({ count: 2, pipelines: 2, hidden: 1 });
  });
});

describe('reason mapping from real classifier output', () => {
  it.each([
    [{ stage: 'replied' }, 'Replied'], [{ opted_out: true }, 'Opted out'], [{ stage: 'won' }, 'Already won or lost'],
    [{ email: 'a@blocked.test' }, 'On the blocklist'], [{ last_contacted_at: '2026-07-04T22:30:00Z' }, 'Contacted 3 days ago'],
  ] as [Partial<Lead>, string][])('explains the classifier result: %j', (patch, expected) => {
    const group = groupSelectableLeads([{ id: 'p', name: 'Pipeline' } as Pipeline], [row('a', patch)], new Map(), new Set(['blocked.test']), new Date('2026-07-07T22:59:59.999Z'), now);
    expect(pickerReason(group[0]!.leads[0]!, now)).toBe(expected);
  });
  it.each([
    ['paused', 'Sequence paused'], ['not_due', 'Not due yet'], ['pending_review', 'Has an email waiting for review'],
    ['due', 'Due today or overdue'], ['new', 'Ready to pick'],
  ] as [PickerLead['reason'], string][])('explains %s', (reason, expected) => expect(pickerReason(row('a', { reason }), now)).toBe(expected));
});
