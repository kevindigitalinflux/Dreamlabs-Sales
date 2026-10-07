import { describe, expect, it } from 'vitest';
import {
  RECENT_CONTACT_DAYS,
  endOfLocalDay,
  localDateString,
  classifyLead,
  findUnfilledPlaceholders,
  inWindow,
  windowBounds,
  zonedTimeToUtc,
  type EligibilityLead,
} from '../../supabase/functions/_shared/autopilotEligibility';

const now = new Date('2026-10-07T10:00:00.000Z');
const endOfToday = new Date('2026-10-07T23:59:59.999Z');
const lead = (o: Partial<EligibilityLead> = {}): EligibilityLead => ({ id: 'l1', opted_out: false, email: 'a@acme.com', stage: 'new_lead', last_contacted_at: null, ...o });
const none = new Set<string>();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000).toISOString();

describe('classifyLead', () => {
  it('opted out', () => {
    expect(classifyLead(lead({ opted_out: true }), null, none, endOfToday, now)).toEqual({ eligible: false, reason: 'opted_out' });
  });
  it('blocked by exact email', () => {
    expect(classifyLead(lead(), null, new Set(['a@acme.com']), endOfToday, now)).toEqual({ eligible: false, reason: 'blocked' });
  });
  it('blocked by email case-insensitively', () => {
    expect(classifyLead(lead({ email: 'A@Acme.com' }), null, new Set(['a@acme.com']), endOfToday, now)).toEqual({ eligible: false, reason: 'blocked' });
  });
  it('blocked by domain', () => {
    expect(classifyLead(lead(), null, new Set(['acme.com']), endOfToday, now)).toEqual({ eligible: false, reason: 'blocked' });
  });
  it('won and lost are closed', () => {
    expect(classifyLead(lead({ stage: 'won' }), null, none, endOfToday, now)).toEqual({ eligible: false, reason: 'closed' });
    expect(classifyLead(lead({ stage: 'lost' }), null, none, endOfToday, now)).toEqual({ eligible: false, reason: 'closed' });
  });
  it('active enrolment due before end of today is due', () => {
    expect(classifyLead(lead(), { status: 'active', next_send_at: '2026-10-07T09:00:00.000Z' }, none, endOfToday, now)).toEqual({ eligible: true, reason: 'due' });
  });
  it('active enrolment due tomorrow is not due', () => {
    expect(classifyLead(lead(), { status: 'active', next_send_at: '2026-10-08T09:00:00.000Z' }, none, endOfToday, now)).toEqual({ eligible: false, reason: 'not_due' });
  });
  it('paused enrolment', () => {
    expect(classifyLead(lead(), { status: 'paused', next_send_at: null }, none, endOfToday, now)).toEqual({ eligible: false, reason: 'paused' });
  });
  it('never contacted, no enrolment is new', () => {
    expect(classifyLead(lead(), null, none, endOfToday, now)).toEqual({ eligible: true, reason: 'new' });
  });
  it('contacted 3 days ago is recently_contacted', () => {
    expect(classifyLead(lead({ last_contacted_at: daysAgo(3) }), null, none, endOfToday, now)).toEqual({ eligible: false, reason: 'recently_contacted' });
  });
  it('contacted 30 days ago is new', () => {
    expect(classifyLead(lead({ last_contacted_at: daysAgo(30) }), null, none, endOfToday, now)).toEqual({ eligible: true, reason: 'new' });
  });
  it('completed enrolment falls through to contact recency', () => {
    expect(classifyLead(lead({ last_contacted_at: daysAgo(3) }), { status: 'completed', next_send_at: null }, none, endOfToday, now)).toEqual({ eligible: false, reason: 'recently_contacted' });
  });
  it('lead with no email is still eligible', () => {
    expect(classifyLead(lead({ email: null }), null, none, endOfToday, now)).toEqual({ eligible: true, reason: 'new' });
  });
  it('blocklist entries are normalised (mixed-case email, mixed-case domain, whitespace)', () => {
    const l = lead({ email: 'foo@bar.com' });
    const blocked = { eligible: false, reason: 'blocked' };
    expect(classifyLead(l, null, new Set(['Foo@Bar.com']), endOfToday, now)).toEqual(blocked);
    expect(classifyLead(l, null, new Set(['BAR.com']), endOfToday, now)).toEqual(blocked);
    expect(classifyLead(l, null, new Set(['  foo@bar.com 	']), endOfToday, now)).toEqual(blocked);
  });
  it('active enrolment with null next_send_at is not_due', () => {
    expect(classifyLead(lead(), { status: 'active', next_send_at: null }, none, endOfToday, now)).toEqual({ eligible: false, reason: 'not_due' });
  });
  it('cancelled enrolment is treated as no active enrolment', () => {
    expect(classifyLead(lead(), { status: 'cancelled', next_send_at: null }, none, endOfToday, now)).toEqual({ eligible: true, reason: 'new' });
  });
  it('rule precedence: opted_out beats blocked, blocked beats paused', () => {
    expect(classifyLead(lead({ opted_out: true }), null, new Set(['acme.com']), endOfToday, now)).toEqual({ eligible: false, reason: 'opted_out' });
    expect(classifyLead(lead(), { status: 'paused', next_send_at: null }, new Set(['acme.com']), endOfToday, now)).toEqual({ eligible: false, reason: 'blocked' });
  });
  it('exactly 14 days ago is eligible; just inside 14 days is recently_contacted', () => {
    expect(classifyLead(lead({ last_contacted_at: daysAgo(14) }), null, none, endOfToday, now)).toEqual({ eligible: true, reason: 'new' });
    const inside = new Date(now.getTime() - 14 * 86400000 + 1).toISOString();
    expect(classifyLead(lead({ last_contacted_at: inside }), null, none, endOfToday, now)).toEqual({ eligible: false, reason: 'recently_contacted' });
  });
  it('exposes the recent contact window', () => {
    expect(RECENT_CONTACT_DAYS).toBe(14);
  });
});

describe('zonedTimeToUtc', () => {
  it('BST summer', () => {
    expect(zonedTimeToUtc('2026-07-01', '09:00', 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });
  it('GMT winter', () => {
    expect(zonedTimeToUtc('2026-01-15', '09:00', 'Europe/London').toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });
  it('spring-forward day', () => {
    expect(zonedTimeToUtc('2026-03-29', '09:00', 'Europe/London').toISOString()).toBe('2026-03-29T08:00:00.000Z');
  });
  it('fall-back day', () => {
    expect(zonedTimeToUtc('2026-10-25', '09:00', 'Europe/London').toISOString()).toBe('2026-10-25T09:00:00.000Z');
  });
});

describe('zonedTimeToUtc edge cases', () => {
  it('spring-forward gap resolves after the gap', () => {
    expect(zonedTimeToUtc('2026-03-29', '01:30', 'Europe/London').toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
  it('fall-back overlap resolves to the later occurrence', () => {
    expect(zonedTimeToUtc('2026-10-25', '01:30', 'Europe/London').toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });
  it('half-hour offset zone', () => {
    expect(zonedTimeToUtc('2026-01-01', '09:00', 'Asia/Kolkata').toISOString()).toBe('2026-01-01T03:30:00.000Z');
  });
  it('invalid zone or malformed date throws RangeError', () => {
    expect(() => zonedTimeToUtc('2026-01-01', '09:00', 'Nope/Zone')).toThrow(RangeError);
    expect(() => zonedTimeToUtc('garbage', '09:00', 'Europe/London')).toThrow(RangeError);
  });
});

describe('localDateString / endOfLocalDay', () => {
  it('London summer day', () => {
    expect(endOfLocalDay(new Date('2026-07-01T12:00:00Z'), 'Europe/London').toISOString()).toBe('2026-07-01T22:59:59.999Z');
  });
  it('London winter day', () => {
    expect(endOfLocalDay(new Date('2026-01-15T12:00:00Z'), 'Europe/London').toISOString()).toBe('2026-01-15T23:59:59.999Z');
  });
  it('spring-forward day is 23 hours', () => {
    expect(endOfLocalDay(new Date('2026-03-29T12:00:00Z'), 'Europe/London').toISOString()).toBe('2026-03-29T22:59:59.999Z');
  });
  it('fall-back day is 25 hours', () => {
    expect(endOfLocalDay(new Date('2026-10-25T12:00:00Z'), 'Europe/London').toISOString()).toBe('2026-10-25T23:59:59.999Z');
  });
  it('date rolls by zone not by UTC', () => {
    const late = new Date('2026-07-01T22:30:00Z'); // 23:30 BST on 1 July
    const early = new Date('2026-07-01T23:30:00Z'); // 00:30 BST on 2 July
    expect(localDateString(late, 'Europe/London')).toBe('2026-07-01');
    expect(localDateString(early, 'Europe/London')).toBe('2026-07-02');
    expect(endOfLocalDay(late, 'Europe/London').toISOString()).toBe('2026-07-01T22:59:59.999Z');
    expect(endOfLocalDay(early, 'Europe/London').toISOString()).toBe('2026-07-02T22:59:59.999Z');
  });
  it('month and year rollover', () => {
    expect(endOfLocalDay(new Date('2026-12-31T12:00:00Z'), 'Europe/London').toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });
});

describe('windowBounds / inWindow', () => {
  it('returns null when end is not after start', () => {
    expect(windowBounds('2026-07-01', '17:00', '09:00', 'Europe/London')).toBeNull();
    expect(windowBounds('2026-07-01', '09:00', '09:00', 'Europe/London')).toBeNull();
  });
  it('across the spring-forward transition', () => {
    const b = windowBounds('2026-03-29', '00:30', '03:30', 'Europe/London')!;
    expect(b.startUtc.toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(b.endUtc.toISOString()).toBe('2026-03-29T02:30:00.000Z');
  });
  it('is start-inclusive and end-exclusive', () => {
    const b = windowBounds('2026-07-01', '09:00', '17:00', 'Europe/London')!;
    expect(b.startUtc.toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(b.endUtc.toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(inWindow(new Date('2026-07-01T07:59:59.999Z'), b)).toBe(false);
    expect(inWindow(b.startUtc, b)).toBe(true);
    expect(inWindow(new Date('2026-07-01T15:59:59.999Z'), b)).toBe(true);
    expect(inWindow(b.endUtc, b)).toBe(false);
  });
});

describe('findUnfilledPlaceholders', () => {
  it('finds names', () => {
    expect(findUnfilledPlaceholders('Hi {{first_name}} and {{ pain_point }}')).toEqual(['first_name', 'pain_point']);
  });
  it('returns duplicates as repeats', () => {
    expect(findUnfilledPlaceholders('{{a}} {{a}}')).toEqual(['a', 'a']);
  });
  it('empty for clean text', () => {
    expect(findUnfilledPlaceholders('Hi there')).toEqual([]);
  });
});
