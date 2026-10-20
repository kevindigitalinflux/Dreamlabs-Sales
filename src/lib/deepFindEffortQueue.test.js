import { expect, it } from 'vitest';
import { queueRun } from '../../supabase/functions/_shared/deepFindLeadActions';
import { runDeepFindTick } from '../../supabase/functions/_shared/deepFind';

function database() {
  const tables = { deep_find_runs: [], deep_find_leads: [], org_members: [{ user_id: 'user', org_id: 'org' }], leads: [] };
  const service = { async rpc(name) {
    if (name !== 'deep_find_claim') throw new Error('Unexpected RPC');
    const row = tables.deep_find_leads.find(r => r.status === 'queued');
    if (row) { row.status = 'running'; row.attempts = (row.attempts ?? 0) + 1; }
    return { data: row ? [structuredClone(row)] : [], error: null };
  }, from(table) {
    const filters = []; let additions, patch, remove = false;
    const result = () => {
      if (additions) {
        const data = { id: table === 'deep_find_runs' ? 'run' : 'row' + tables[table].length, status: table === 'deep_find_runs' ? 'active' : 'queued', ...additions };
        tables[table].push(data); return { data: [data], error: null };
      }
      const rows = tables[table].filter(r => filters.every(([key, op, v]) => {
        const actual = key === 'deep_find_runs.status' ? 'active' : r[key];
        return op === 'eq' ? actual === v : op === 'neq' ? actual !== v : v.includes(actual);
      }));
      if (patch) rows.forEach(r => Object.assign(r, patch));
      if (remove) tables[table] = tables[table].filter(r => !rows.includes(r));
      return { data: rows.map(r => structuredClone(r)), error: null };
    };
    const query = { select: () => query, eq: (k,v) => { filters.push([k,'eq',v]); return query; }, neq: (k,v) => { filters.push([k,'neq',v]); return query; },
      in: (k,v) => { filters.push([k,'in',v]); return query; }, insert: value => { additions = value; return query; },
      update: value => { patch = value; return query; }, delete: () => { remove = true; return query; },
      single: async () => { const r = result(); return { ...r, data: r.data[0] ?? null }; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data[0] ?? null }; }, then: resolve => resolve(result()) };
    return query;
  } };
  return { service, tables };
}
it('stores effort on every queued row, not on an invented run column', async () => {
  const { service, tables } = database();
  expect(await queueRun(service, 'org', 'user', ['a','b'], { hunter: 2, ai: 4 }, 'medium')).toMatchObject({ queued: 2 });
  expect(tables.deep_find_runs[0]).toMatchObject({ credit_cap_hunter: 2, credit_cap_ai: 4 });
  expect(tables.deep_find_runs[0]).not.toHaveProperty('effort');
  expect(tables.deep_find_leads.map(r => r.domains)).toEqual(Array(2).fill({ effort: 'medium', effort_caps: { hunter: 1, ai: 2, firecrawl: 1 } }));
});
it('claim-time metadata survives an early failed outcome and a later tick', async () => {
  const { service, tables } = database();
  await queueRun(service, 'org', 'user', ['a'], { hunter: 1, ai: 2 }, 'medium');
  expect(await runDeepFindTick(service, Date.now())).toBe(1);
  expect(tables.deep_find_leads[0]).toMatchObject({ status: 'skipped', domains: { effort: 'medium', effort_caps: { hunter: 1, ai: 2, firecrawl: 1 } } });
  expect(tables.deep_find_leads[0].domains.steps.join(' ')).toContain('Medium effort');
  expect(await runDeepFindTick(service, Date.now())).toBe(0);
});
it('legacy queue calls use Custom numeric caps', async () => {
  const { service, tables } = database();
  await queueRun(service, 'org', 'user', ['a'], { hunter: 20, ai: 5 });
  expect(tables.deep_find_leads[0].domains).toEqual({ effort: 'custom', effort_caps: { hunter: 20, ai: 5 } });
});
it('keeps Start fresh metadata and restoration counts through an early skipped lead', async () => {
  const { service, tables } = database();
  await queueRun(service, 'org', 'user', ['a'], { hunter: 0, ai: 0 }, 'low', { a: 2 });
  expect(tables.deep_find_leads[0].domains).toMatchObject({ start_fresh: true, steps: ['Start fresh: restored 2 dismissed people and cleared dismissed suggestions'] });
  await runDeepFindTick(service, Date.now());
  expect(tables.deep_find_leads[0].domains).toMatchObject({ start_fresh: true });
  expect(tables.deep_find_leads[0].domains.steps).toContain('Start fresh: restored 2 dismissed people and cleared dismissed suggestions');
});
