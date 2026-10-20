import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { expect, it, vi } from 'vitest';
import { parseCreateRequest } from '../../supabase/functions/_shared/deepFindRules';

// Execute the real edge handler with local adapters. No Deno, credentials, network or database is used.
function handler({ denied = false, busy = false } = {}) {
  let serve;
  const ids = ['3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e'];
  const service = { from: vi.fn(table => {
    const q = { select: () => q, eq: () => q, in: () => q,
      then: resolve => resolve({ data: busy && table === 'deep_find_leads' ? [{ lead_id: ids[0] }] : [], count: 0, error: null }) };
    return q;
  }) };
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } };
  const authorize = vi.fn(async (_c, _s, _u, _ids, fresh) => denied
    ? { ok: false, result: { status: 403, body: { error: 'Forbidden' } } }
    : { ok: true, orgId: 'org', restored: fresh ? { [ids[0]]: 2 } : {} });
  const queue = vi.fn(async () => ({ runId: 'run', queued: 1, raced: 0 }));
  const rate = vi.fn(async () => true);
  let clients = 0;
  const adapters = {
    'npm:@supabase/supabase-js@2': { createClient: () => clients++ ? client : service },
    '../_shared/cors.ts': { corsHeaders: () => ({}), json: (body, status) => new Response(JSON.stringify(body), { status }) },
    '../_shared/rateLimit.ts': { checkRateLimit: rate },
    '../_shared/deepFind.ts': { runDeepFindTick: async () => 0 },
    '../_shared/deepFindRules.ts': { parseCreateRequest },
    '../_shared/timingSafe.ts': {},
    '../_shared/deepFindLeadActions.ts': { queueRun: queue },
    '../_shared/deepFindCreate.ts': { authorizeDeepFindCreate: authorize },
    '../_shared/orgApiKeys.ts': {}, '../_shared/knownPersonLookup.ts': {}, '../_shared/hunterLimits.ts': {},
  };
  const source = readFileSync('supabase/functions/run-deep-find/index.ts', 'utf8');
  const code = stripTypeScriptTypes(source).replace(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g,
    (_line, names, module) => `const {${names}} = require('${module}');`);
  new Function('require', 'Deno', 'exports', code)(name => {
    if (!(name in adapters)) throw new Error(`Unexpected edge import: ${name}`);
    return adapters[name];
  }, { env: { get: () => undefined }, serve: fn => { serve = fn; } }, {});
  return { service, authorize, queue, rate, ids,
    request: body => serve(new Request('https://local.test', { method: 'POST', body: JSON.stringify({ action: 'create', lead_ids: ids, ...body }) })) };
}
it('returns 403 before any service operation or queue call when selection authorization fails', async () => {
  const h = handler({ denied: true });
  expect((await h.request({ start_fresh: true })).status).toBe(403);
  expect(h.service.from).not.toHaveBeenCalled();
  expect(h.rate).not.toHaveBeenCalled();
  expect(h.queue).not.toHaveBeenCalled();
});
it('queues Start fresh with restoration counts only after rechecking the complete selection', async () => {
  const h = handler();
  expect((await h.request({ start_fresh: true })).status).toBe(202);
  expect(h.authorize).toHaveBeenCalledTimes(2);
  expect(h.authorize.mock.calls[1].slice(2)).toEqual(['user', h.ids, true]);
  expect(h.queue.mock.calls[0].at(-1)).toEqual({ [h.ids[0]]: 2 });
});
it('rejects invalid Start fresh before authorization or writes', async () => {
  const h = handler();
  expect((await h.request({ start_fresh: 'true' })).status).toBe(400);
  expect(h.authorize).not.toHaveBeenCalled();
  expect(h.queue).not.toHaveBeenCalled();
});
it('keeps ordinary creates free of restoration', async () => {
  const h = handler();
  expect((await h.request({})).status).toBe(202);
  expect(h.authorize).toHaveBeenCalledTimes(1);
  expect(h.queue.mock.calls[0].at(-1)).toBeUndefined();
});
it('refuses Start fresh for a busy selection before restoration or queueing', async () => {
  const h = handler({ busy: true });
  expect((await h.request({ start_fresh: true })).status).toBe(409);
  expect(h.authorize).toHaveBeenCalledTimes(1);
  expect(h.queue).not.toHaveBeenCalled();
});
