// Fires many usage_reserve calls IN PARALLEL (each is its own database connection and transaction through the
// Supabase Management API) and proves the cap holds. Usage: node scripts/usage-concurrency-test.mjs
// Reads SUPABASE_ACCESS_TOKEN from the project's gitignored .env. Creates one throwaway organisation, restores the
// worker-wide counter it touched, and deletes the organisation (cascade removes its limit and counters).
import { readFileSync } from 'node:fs';

const REF = 'wgomksxelyfkzepbnkdd';
const LIMIT = 10;
const CALLS = 40;
const RESOURCE = 'worker_fetch';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const token = env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN missing from .env');

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL failed (${res.status})`);
  return res.json();
}

const day = "(now() AT TIME ZONE 'Europe/London')::date";
const [{ id: org }] = await sql("INSERT INTO public.organizations (name) VALUES ('usage-concurrency-test') RETURNING id");
let failed = false;
try {
  const before = (await sql(`SELECT COALESCE((SELECT used FROM public.usage_global_counters WHERE resource = '${RESOURCE}' AND day = ${day}), 0) AS used`))[0].used;
  await sql(`INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES ('${org}', '${RESOURCE}', ${LIMIT})`);

  const results = await Promise.all(Array.from({ length: CALLS }, () => sql(`SELECT public.usage_reserve('${org}', '${RESOURCE}', 1) AS r`)));
  const oks = results.filter((r) => r[0].r.ok === true).length;
  const refusals = results.filter((r) => r[0].r.ok === false && r[0].r.reason === 'org_limit').length;
  const used = (await sql(`SELECT used FROM public.usage_counters WHERE org_id = '${org}' AND resource = '${RESOURCE}' AND day = ${day}`))[0].used;
  const after = (await sql(`SELECT used FROM public.usage_global_counters WHERE resource = '${RESOURCE}' AND day = ${day}`))[0].used;

  console.log(`parallel calls=${CALLS} limit=${LIMIT} -> ok=${oks}, org_limit refusals=${refusals}, org counter=${used}, worker-wide counter moved by ${after - before}`);
  const pass = oks === LIMIT && refusals === CALLS - LIMIT && used === LIMIT && after - before === LIMIT;
  console.log(pass ? 'PASS: the cap held under concurrency' : 'FAIL: the cap did not hold');
  failed = !pass;
  // Put the worker-wide counter back exactly as it was.
  await sql(`UPDATE public.usage_global_counters SET used = ${before} WHERE resource = '${RESOURCE}' AND day = ${day}`);
} finally {
  await sql(`DELETE FROM public.organizations WHERE id = '${org}'`);
  const left = (await sql("SELECT count(*)::int AS n FROM public.organizations WHERE name = 'usage-concurrency-test'"))[0].n;
  console.log(`cleanup: leftover test organisations = ${left}`);
}
process.exit(failed ? 1 : 0);
