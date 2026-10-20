import { expect, it, vi } from 'vitest';
import { authorizeDeepFindCreate } from '../../supabase/functions/_shared/deepFindCreate';

const ids = ['3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'];
function database({ member = true, denied = [], foreign = false } = {}) {
  const tables = {
    leads: ids.map((id, i) => ({ id, org_id: foreign && i ? 'other' : 'org', dismissed_suggestions: ['owner:Jane Smith'] })),
    org_members: member ? [{ user_id: 'user', org_id: 'org', role: 'member' }] : [],
    decision_maker_candidates: [...['manual', 'dream_agent', 'companies_house', 'cro', 'hunter', 'apollo', 'unknown'].map((source, i) => ({ id: 'c' + i, lead_id: ids[0], source, dismissed_at: 'yesterday' })),
      { id: 'outside', lead_id: 'outside', source: 'companies_house', dismissed_at: 'yesterday' }],
  };
  const writes = [];
  const client = { rpc: vi.fn(async (_name, args) => ({ data: !denied.includes(args.target_lead), error: null })), from(table) {
    const filters = []; let patch;
    const result = () => {
      const rows = tables[table].filter(r => filters.every(f => f(r)));
      if (patch) { writes.push({ table, ids: rows.map(r => r.id), patch }); rows.forEach(r => Object.assign(r, patch)); }
      return { data: rows.map(r => ({ ...r })), error: null };
    };
    const q = { select: () => q, eq: (k, v) => { filters.push(r => r[k] === v); return q; },
      in: (k, v) => { filters.push(r => v.includes(r[k])); return q; },
      not: (k, _op, v) => { filters.push(r => r[k] !== v); return q; },
      update: p => { patch = p; return q; },
      maybeSingle: async () => { const out = result(); return { ...out, data: out.data[0] ?? null }; }, then: resolve => resolve(result()) };
    return q;
  } };
  return { client, service: client, tables, writes };
}
it.each([{ member: false }, { denied: [ids[0]] }, { denied: [ids[1]] }, { foreign: true }])('refuses all changes when any selected lead lacks permission: %j', async options => {
  const db = database(options);
  const out = await authorizeDeepFindCreate(db.client, db.service, 'user', ids, true);
  expect(out.ok).toBe(false);
  expect(out.result.status).toBe(403);
  expect(db.writes).toEqual([]);
});
it('restores only automatic dismissed contacts of selected leads and clears only dismissal memory', async () => {
  const db = database();
  const out = await authorizeDeepFindCreate(db.client, db.service, 'user', [ids[0]], true);
  expect(out).toMatchObject({ ok: true, restored: { [ids[0]]: 4 } });
  expect(db.tables.leads[0].dismissed_suggestions).toEqual([]);
  expect(db.tables.leads[1].dismissed_suggestions).not.toEqual([]);
  for (const c of db.tables.decision_maker_candidates) expect(c.dismissed_at).toBe(['c2', 'c3', 'c4', 'c5'].includes(c.id) ? null : 'yesterday');
  expect(db.writes.every(w => Object.keys(w.patch).length === 1)).toBe(true);
});
it('default create checks permissions without restoring anything', async () => {
  const db = database();
  expect(await authorizeDeepFindCreate(db.client, db.service, 'user', ids)).toMatchObject({ ok: true });
  expect(db.writes).toEqual([]);
});
