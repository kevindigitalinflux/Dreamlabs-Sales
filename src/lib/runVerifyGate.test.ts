import { expect, it } from 'vitest';
import { RunVerifyGate, type VerifyGateStore } from '../../supabase/functions/_shared/runVerifyGate';
import { WORKER_TIMEOUT_MS } from '../../supabase/functions/_shared/workerRules';
import { GUESS_CHECK_TIMEOUT_MS, GuessChecks } from '../../supabase/functions/_shared/personEmailFinding';

function fixture() {
 let state: Record<string, unknown> = {}; let version = 0; let now = 0;
 const starts: number[] = [];
 const store: VerifyGateStore = {
  read: async () => ({ state: structuredClone(state), version: String(version) }),
  swap: async (expected, next) => { if (expected !== String(version)) return false; state = structuredClone(next); version++; return true; },
 };
 const gate = () => new RunVerifyGate(store, () => now, async ms => { now += ms; });
 const check = async () => { starts.push(now); return { ok: true as const, value: { status: 'invalid' as const, reason: 'mailbox_missing' as const } }; };
 return { gate, check, starts, store };
}
it('allows 33 seconds for client and guess checks', () => {
 expect(WORKER_TIMEOUT_MS.verify).toBe(33000);
 expect(GUESS_CHECK_TIMEOUT_MS).toBe(33000);
});
it.each(['timeout', 'provider_blocks_checks'])('stops a run/domain after one %s across fresh instances', async reason => {
 const f = fixture(); let calls = 0;
 const first = await f.gate().run('a@example.com', 33000, async () => { calls++; return reason === 'timeout'
  ? { ok: false, failure: 'timeout', line: 'timeout' }
  : { ok: true, value: { status: 'unverifiable', reason: 'provider_blocks_checks' } }; });
 const second = await f.gate().run('b@example.com', 33000, f.check);
 expect(first).toBeDefined(); expect(second.ok).toBe(false); expect(calls).toBe(1); expect(f.starts).toEqual([]);
 expect((await f.gate().run('a@other.com', 33000, f.check)).ok).toBe(true);
});
it('paces a sixth same-domain check beyond a minute without reserving while waiting', async () => {
 const f = fixture();
 for (let i=0;i<6;i++) expect((await f.gate().run(`${i}@example.com`, 120000, f.check)).ok).toBe(true);
 expect(f.starts).toHaveLength(6);
 expect(f.starts[5]! - f.starts[0]!).toBeGreaterThan(60000);
});
it('fails closed when the store fails', async () => {
 let called = false;
 const gate = new RunVerifyGate({ read: async () => { throw new Error('offline'); }, swap: async () => false });
 expect((await gate.run('a@example.com',33000, async () => { called=true; return { ok:false, failure:'timeout', line:'timeout' }; })).ok).toBe(false);
 expect(called).toBe(false);
});
it('blocks GuessChecks after its first timeout without blocking another domain', () => {
 const checks = new GuessChecks(); checks.record('a@example.com', null, 'timeout');
 expect(checks.canCheck('b@example.com')).toBe(false);
 expect(checks.canCheck('b@other.com')).toBe(true);
});

it('keeps an abandoned pending call closed across a new gate instance', async () => {
 const f = fixture();
 await f.gate().run('a@example.com',33000, async () => { throw new Error('worker interrupted'); });
 expect((await f.gate().run('b@example.com',33000,f.check)).ok).toBe(false);
 expect(f.starts).toEqual([]);
});
it('does not dispatch a shorter check when spacing leaves less than 33 seconds', async () => {
 const f=fixture(); await f.gate().run('a@example.com',33000,f.check);
 expect((await f.gate().run('b@example.com',33000,f.check)).ok).toBe(false);
 expect(f.starts).toHaveLength(1);
});
