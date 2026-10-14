import { describe, expect, it } from 'vitest';
import { refundUsage, reserveUsage, type UsageClient } from '../../supabase/functions/_shared/usage';

const client = (reply: { data: unknown; error: { message: string } | null } | (() => never)): UsageClient & { calls: Array<[string, Record<string, unknown>]> } => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    rpc: (fn, args) => {
      calls.push([fn, args]);
      if (typeof reply === 'function') reply();
      return Promise.resolve(reply as { data: unknown; error: { message: string } | null });
    },
  };
};

describe('reserveUsage', () => {
  it('calls usage_reserve with the organisation, resource and units, and parses the answer', async () => {
    const c = client({ data: { ok: true, day: '2026-10-14', used: 1, limit: 100, global_used: 1, global_limit: 400 }, error: null });
    expect(await reserveUsage(c, 'org-1', 'worker_scrape', 3)).toEqual({ ok: true, day: '2026-10-14', used: 1, limit: 100 });
    expect(c.calls).toEqual([['usage_reserve', { p_org: 'org-1', p_resource: 'worker_scrape', p_units: 3 }]]);
  });
  it('defaults to one unit', async () => {
    const c = client({ data: { ok: false, reason: 'org_limit', limit: 150 }, error: null });
    expect(await reserveUsage(c, 'org-1', 'worker_verify')).toEqual({ ok: false, reason: 'org_limit', limit: 150 });
    expect(c.calls[0]?.[1]).toMatchObject({ p_units: 1 });
  });
  it('fails closed on an rpc error, junk, or a thrown exception', async () => {
    expect(await reserveUsage(client({ data: null, error: { message: 'boom' } }), 'o', 'worker_fetch')).toEqual({ ok: false, reason: 'error' });
    expect(await reserveUsage(client({ data: 'yes', error: null }), 'o', 'worker_fetch')).toEqual({ ok: false, reason: 'error' });
    expect(await reserveUsage(client(() => { throw new Error('network'); }), 'o', 'worker_fetch')).toEqual({ ok: false, reason: 'error' });
  });
});

describe('refundUsage', () => {
  it('calls usage_refund with the day returned by the reserve', async () => {
    const c = client({ data: true, error: null });
    expect(await refundUsage(c, 'org-1', 'worker_fetch', 1, '2026-10-14')).toBe(true);
    expect(c.calls).toEqual([['usage_refund', { p_org: 'org-1', p_resource: 'worker_fetch', p_units: 1, p_day: '2026-10-14' }]]);
  });
  it('never throws: an error or junk is just false', async () => {
    expect(await refundUsage(client({ data: null, error: { message: 'x' } }), 'o', 'worker_fetch', 1, '2026-10-14')).toBe(false);
    expect(await refundUsage(client({ data: 'maybe', error: null }), 'o', 'worker_fetch', 1, '2026-10-14')).toBe(false);
    expect(await refundUsage(client(() => { throw new Error('network'); }), 'o', 'worker_fetch', 1, '2026-10-14')).toBe(false);
  });
});
