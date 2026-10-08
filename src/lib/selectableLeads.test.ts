import { describe, expect, it } from 'vitest';
import { emailGateMessage, groupSelectableLeads, mapRunInsertError, pruneSelection, selectionState, setIds, spendCapToCents, validateCaps, validateWindow } from './selectableLeads';
import type { Lead, Pipeline } from '../types';

const now = new Date('2026-10-07T10:00:00.000Z');
const end = new Date('2026-10-07T23:59:59.999Z');
const pl = (id: string) => ({ id, name: `P${id}` }) as Pipeline;
const ld = (id: string, pipeline_id: string, o: Partial<Lead> = {}) =>
  ({ id, pipeline_id, business_name: id, email: 'a@x.com', stage: 'new_lead', opted_out: false, last_contacted_at: null, ...o }) as Lead;

describe('groupSelectableLeads', () => {
  it('groups, hides ineligible and counts them, omits empty pipelines', () => {
    const groups = groupSelectableLeads(
      [pl('1'), pl('2'), pl('3')],
      [ld('a', '1'), ld('b', '1', { opted_out: true }), ld('c', '2', { stage: 'won' })],
      new Map(), new Set(), end, now,
    );
    expect(groups.map((g) => g.pipelineId)).toEqual(['1', '2']);
    expect(groups[0]).toMatchObject({ hiddenCount: 1 });
    expect(groups[0]!.eligible.map((l) => [l.id, l.reason])).toEqual([['a', 'new']]);
    expect(groups[1]).toMatchObject({ hiddenCount: 1, eligible: [] });
  });
});

describe('selection helpers', () => {
  it('reports state', () => {
    expect(selectionState([], new Set())).toBe('none');
    expect(selectionState(['a', 'b'], new Set(['a']))).toBe('some');
    expect(selectionState(['a', 'b'], new Set(['a', 'b', 'z']))).toBe('all');
  });
  it('adds and removes without mutating', () => {
    const s = new Set(['x']);
    expect([...setIds(s, ['a', 'b'], true)].sort()).toEqual(['a', 'b', 'x']);
    expect([...setIds(s, ['x'], false)]).toEqual([]);
    expect([...s]).toEqual(['x']);
  });
});

describe('validateWindow', () => {
  it('accepts a window later today', () => expect(validateWindow('09:00', '17:00', 'Europe/London', now)).toBeNull());
  it('rejects finish before start', () => expect(validateWindow('17:00', '09:00', 'Europe/London', now)).toBe('Finish time must be after start time'));
  it('rejects a finish already past', () => expect(validateWindow('08:00', '09:00', 'Europe/London', now)).toBe('Finish time has already passed today'));
  it('rejects empty times and bad zones', () => {
    expect(validateWindow('', '09:00', 'Europe/London', now)).not.toBeNull();
    expect(validateWindow('09:00', '17:00', 'Nope/Zone', now)).toBe('Choose a valid timezone');
  });
});

describe('pruneSelection', () => {
  const groups = groupSelectableLeads([pl('1')], [ld('a', '1'), ld('b', '1', { opted_out: true })], new Map(), new Set(), end, now);
  it('drops stale, hidden and other-org ids', () => {
    expect(pruneSelection(new Set(['a', 'b', 'gone', 'other-org']), groups)).toEqual(['a']);
  });
  it('is empty when nothing selected is visible', () => {
    expect(pruneSelection(new Set(['zzz']), groups)).toEqual([]);
  });
});

describe('mapRunInsertError', () => {
  it('maps unique violations', () => {
    expect(mapRunInsertError({ code: '23505', message: 'x' })).toMatch(/already have a selected-leads run/);
    expect(mapRunInsertError({ message: 'duplicate key autopilot_runs_one_active_per_org_mode' })).toMatch(/already have/);
  });
  it('passes other errors through', () => expect(mapRunInsertError({ code: '42501', message: 'denied' })).toBe('denied'));
});

describe('caps', () => {
  it('validates daily sends', () => {
    expect(validateCaps(0, '')).not.toBeNull();
    expect(validateCaps(2.5, '')).not.toBeNull();
    expect(validateCaps(5, '')).toBeNull();
  });
  it('validates spend cap', () => {
    expect(validateCaps(5, '-3')).not.toBeNull();
    expect(validateCaps(5, 'abc')).not.toBeNull();
    expect(validateCaps(5, '0')).toBeNull();
    expect(validateCaps(5, '12.5')).toBeNull();
  });
  it('empty or zero is no cap', () => {
    expect(spendCapToCents('')).toBeNull();
    expect(spendCapToCents('0')).toBeNull();
    expect(spendCapToCents('12.5')).toBe(1250);
  });
});

describe('daily cap upper bound and email gate', () => {
  it('rejects more than the maximum with a plain message', () => {
    expect(validateCaps(200, '')).toBeNull();
    expect(validateCaps(201, '')).toBe('Daily sends cannot be more than 200');
  });
  it('blocks only when the mailbox is missing or unverified', () => {
    expect(emailGateMessage('unknown')).toBeNull();
    expect(emailGateMessage({ verified: true })).toBeNull();
    expect(emailGateMessage({ verified: false })).toContain('verify your email');
    expect(emailGateMessage(null)).toContain('Set up and verify');
  });
});
