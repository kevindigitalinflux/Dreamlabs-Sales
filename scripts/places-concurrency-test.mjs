// Prepared only. Requires a disposable LOCAL PostgreSQL database with migrations applied.
// Never point this script at Supabase or a shared database. It does not read project .env or API keys.
// Usage: set PGHOST=127.0.0.1, PGDATABASE=<name>_places_test and normal psql credentials, then run with --local-test.
import { spawn } from 'node:child_process';
if (!process.argv.includes('--local-test') || !['127.0.0.1', 'localhost', '::1'].includes(process.env.PGHOST)
  || !process.env.PGDATABASE?.endsWith('_places_test') || process.env.PGSERVICE) {
  throw new Error('Requires --local-test, a local PGHOST, and a disposable PGDATABASE ending _places_test.');
}
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    // Never print connection strings, SQL diagnostics or credentials.
    child.stderr.resume();
    child.on('error', () => reject(new Error('Could not start local psql.')));
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error('Local test SQL failed.')));
    child.stdin.end(query);
  });
}
const month = "date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date";
const a = await sql("INSERT INTO public.organizations(name) VALUES ('places-concurrency-a') RETURNING id;");
const b = await sql("INSERT INTO public.organizations(name) VALUES ('places-concurrency-b') RETURNING id;");
// psql includes INSERT command tags; extract and validate only UUIDs.
const uuid = text => { const id = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0]; if (!id) throw new Error('Missing fixture id.'); return id; };
const orgA = uuid(a), orgB = uuid(b);
const original = JSON.parse(await sql(`SELECT json_build_object('limit', (SELECT monthly_limit FROM public.places_shared_limit WHERE singleton), 'used', (SELECT used FROM public.places_shared_counters WHERE month = ${month}));`));
try {
  await sql(`INSERT INTO public.places_usage_limits(org_id, monthly_limit) VALUES ('${orgA}',20),('${orgB}',20);
    UPDATE public.places_shared_limit SET monthly_limit = 10 WHERE singleton;
    INSERT INTO public.places_shared_counters(month,used) VALUES (${month},0) ON CONFLICT(month) DO UPDATE SET used=0;`);
  const calls = await Promise.all(Array.from({ length: 40 }, (_, i) => sql(`SELECT public.places_reserve('${i % 2 ? orgA : orgB}',1,true);`).then(JSON.parse)));
  const successes = calls.filter(r => r.ok);
  const used = Number(await sql(`SELECT used FROM public.places_shared_counters WHERE month=${month};`));
  if (successes.length !== 10 || used !== 10 || calls.some(r => !r.ok && !['org_limit', 'shared_pool'].includes(r.reason))) throw new Error('Shared cap failed under concurrency.');
  const own = await sql(`SELECT public.places_reserve('${orgA}',1,false);`);
  if (!JSON.parse(own).ok) throw new Error('Own key was incorrectly blocked by the shared cap.');
  const reservation = successes[0];
  const id = uuid(reservation.reservation_id);
  const owner = await sql(`SELECT org_id FROM public.places_reservations WHERE id='${id}';`);
  const refunds = await Promise.all(Array.from({ length: 8 }, () => sql(`SELECT public.places_refund('${uuid(owner)}',1,'${reservation.month}','${id}');`)));
  if (refunds.filter(r => r === 't').length !== 1) throw new Error('Duplicate refund succeeded.');
  console.log('PASS: 40 parallel reserves, 10 admitted; own key independent; 8 parallel refunds, 1 admitted.');
} finally {
  await sql(`DELETE FROM public.organizations WHERE id IN ('${orgA}','${orgB}');
    UPDATE public.places_shared_limit SET monthly_limit=${Number(original.limit)} WHERE singleton;
    ${original.used === null ? `DELETE FROM public.places_shared_counters WHERE month=${month};` : `UPDATE public.places_shared_counters SET used=${Number(original.used)} WHERE month=${month};`}`);
}
