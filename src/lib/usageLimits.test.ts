import { describe, expect, it } from 'vitest';
import { saveUsageLimit, type LimitsClient } from './usageLimits';

type Reply = { data: unknown[] | null; error: { message: string } | null };

/** A fake that records the calls made against usage_limits. */
function fake(updateReply: Reply, insertError: { message: string } | null = null) {
  const calls: string[] = [];
  const client: LimitsClient = {
    from(table) {
      calls.push(`from:${table}`);
      return {
        update(values) {
          calls.push(`update:${JSON.stringify(values)}`);
          return {
            eq(c1, v1) {
              return {
                eq(c2, v2) {
                  calls.push(`where:${c1}=${v1},${c2}=${v2}`);
                  return { select: () => Promise.resolve(updateReply) };
                },
              };
            },
          };
        },
        insert(values) {
          calls.push(`insert:${JSON.stringify(values)}`);
          return Promise.resolve({ error: insertError });
        },
      };
    },
  };
  return { client, calls };
}

describe('saveUsageLimit', () => {
  it('updates an existing limit and never inserts (an upsert would need UPDATE rights on every column)', async () => {
    const { client, calls } = fake({ data: [{ resource: 'worker_scrape' }], error: null });
    expect(await saveUsageLimit(client, 'org-1', 'worker_scrape', 60)).toEqual({ ok: true });
    expect(calls).toEqual(['from:usage_limits', 'update:{"daily_limit":60}', 'where:org_id=org-1,resource=worker_scrape']);
  });
  it('inserts when nothing was updated (first time this organisation sets that limit)', async () => {
    const { client, calls } = fake({ data: [], error: null });
    expect(await saveUsageLimit(client, 'org-1', 'worker_verify', 200)).toEqual({ ok: true });
    expect(calls).toContain('insert:{"org_id":"org-1","resource":"worker_verify","daily_limit":200}');
  });
  it('reports failure when the update errors, and does not insert', async () => {
    const { client, calls } = fake({ data: null, error: { message: 'permission denied' } });
    expect(await saveUsageLimit(client, 'org-1', 'worker_fetch', 5)).toEqual({ ok: false });
    expect(calls.some((c) => c.startsWith('insert:'))).toBe(false);
  });
  it('reports failure when the insert errors', async () => {
    const { client } = fake({ data: [], error: null }, { message: 'row-level security' });
    expect(await saveUsageLimit(client, 'org-1', 'worker_fetch', 5)).toEqual({ ok: false });
  });
  it('treats a missing data array without an error as nothing updated', async () => {
    const { client, calls } = fake({ data: null, error: null });
    expect(await saveUsageLimit(client, 'org-1', 'worker_fetch', 5)).toEqual({ ok: true });
    expect(calls.some((c) => c.startsWith('insert:'))).toBe(true);
  });
});
