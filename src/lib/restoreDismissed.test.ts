import { describe, expect, it } from 'vitest';
import { joinNames, dismissedContactsOf, planRestore, restoreDismissedContact, restoredMessage, startFreshBody } from './restoreDismissed';

const c = (over: Record<string, unknown> = {}) => ({ id: 'c1', kind: 'person', first_name: 'Jane', last_name: 'Smith', label: null, title: 'Director', source: 'hunter', email: null, dismissed_at: '2026-10-01T00:00:00Z', ...over }) as never;

describe('dismissedContactsOf', () => {
  it('keeps only dismissed rows and describes them', () => {
    const list = dismissedContactsOf([c(), c({ id: 'c2', dismissed_at: null }), c({ id: 'c3', first_name: null, last_name: null, kind: 'general', label: 'Reception', title: null })]);
    expect(list.map((x) => x.id)).toEqual(['c1', 'c3']);
    expect(list[0]).toMatchObject({ name: 'Jane Smith', role: 'Director' });
    expect(list[1].name).toBe('Reception');
  });
});

describe('planRestore', () => {
  it('plans a compare-and-set write only for a dismissed contact', () => {
    expect(planRestore(c())).toEqual({ ok: true, id: 'c1', name: 'Jane Smith' });
    expect(planRestore(c({ dismissed_at: null }))).toEqual({ ok: false, error: 'Jane Smith is already restored.' });
  });
});

function fakeClient(result: { data: unknown; error: unknown }, calls: string[] = []) {
  const q: Record<string, unknown> = {
    update: (p: unknown) => { calls.push(`update ${JSON.stringify(p)}`); return q; },
    eq: (k: string, v: unknown) => { calls.push(`eq ${k}=${v}`); return q; },
    not: (k: string) => { calls.push(`not ${k}`); return q; },
    select: () => q,
    maybeSingle: async () => result,
  };
  return { from: () => q } as never;
}

describe('restoreDismissedContact', () => {
  it('sets dismissed_at null only while still dismissed', async () => {
    const calls: string[] = [];
    const r = await restoreDismissedContact(fakeClient({ data: { id: 'c1' }, error: null }, calls), 'c1', 'Jane Smith');
    expect(r).toEqual({ error: null, message: 'Restored Jane Smith' });
    expect(calls).toContain('update {"dismissed_at":null}');
    expect(calls).toContain('not dismissed_at');
  });
  it('reports a row that changed meanwhile', async () => {
    const r = await restoreDismissedContact(fakeClient({ data: null, error: null }), 'c1', 'Jane Smith');
    expect(r.error).toMatch(/already restored|changed/i);
  });
  it('maps database errors to a coded message', async () => {
    const r = await restoreDismissedContact(fakeClient({ data: null, error: { code: '42501', message: 'x' } }), 'c1', 'Jane Smith');
    expect(r.error).toContain('permission');
    expect(r.error).toContain('42501');
  });
});

describe('restoredMessage / startFreshBody', () => {
  it('announces and builds the request flag', () => {
    expect(restoredMessage('Jane Smith')).toBe('Restored Jane Smith');
    expect(startFreshBody(true)).toEqual({ start_fresh: true });
    expect(startFreshBody(false)).toEqual({});
  });
});

it('joins names', () => {
  expect(joinNames([])).toBe('');
  expect(joinNames(['A'])).toBe('A');
  expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
});
