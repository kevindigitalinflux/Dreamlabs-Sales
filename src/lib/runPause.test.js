import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { preservedQueue, resumedDecision } from '../../supabase/functions/_shared/runPauseRules';
it.each(['paused','active'])('preserves %s queue', status => expect(preservedQueue({status,cancel_reason:null})).toBe(true));
it('preserves only user-stopped cancelled queues', () => {
 expect(preservedQueue({status:'cancelled',cancel_reason:'stopped by user'})).toBe(true);
 expect(preservedQueue({status:'cancelled',cancel_reason:'failure'})).toBe(false);
 expect(preservedQueue({status:'completed',cancel_reason:null})).toBe(false);
});
it.each(['complete_window_closed','complete_send_cap','complete_spend_cap'])('resumed run waits instead of consuming queue: %s', decision => expect(resumedDecision(decision,true)).toBe('wait'));
it('still completes empty resumed runs', () => expect(resumedDecision('complete_no_leads',true)).toBe('complete_no_leads'));
it('migration serializes claim with status and forbids concurrent workers', () => {
 const sql=readFileSync('supabase/migrations/070_autopilot_run_pause.sql','utf8');
 const claim=sql.slice(sql.indexOf('FUNCTION public.autopilot_claim_lead'));
 expect(claim.indexOf('FOR UPDATE')).toBeLessThan(claim.indexOf("status <> 'active'"));
 expect(claim).toContain("status = 'working'");
 expect(sql).toContain("WHERE status IN ('active','paused')");
 expect(sql).toContain('REVOKE ALL ON FUNCTION public.autopilot_claim_lead');
});
