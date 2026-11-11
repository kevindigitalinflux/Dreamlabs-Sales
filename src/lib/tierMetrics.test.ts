import {expect,it} from 'vitest';
import {tierMetrics} from '../../supabase/functions/_shared/tierMetrics';
const now=Date.parse('2026-11-11T12:00:00Z');
const rows=(n:number,bounces:number)=>Array.from({length:n},(_,i)=>({org_id:'org',status:'sent',sent_at:new Date(now-86400000).toISOString(),recipient_tier_version:1,recipient_tier_at_send:'T2',recipient_was_sent_ok:false,hard_bounced_at:i<bounces?new Date(now).toISOString():null}));
it('pauses T2 above eight percent only with at least thirty actual T2 snapshots',()=>{
 expect(tierMetrics('org',rows(29,3),now).t2Allowed).toBe(true);
 expect(tierMetrics('org',rows(30,3),now).t2Allowed).toBe(false);
 expect(tierMetrics('org',rows(50,4),now).t2Allowed).toBe(true);
 expect(tierMetrics('org',rows(50,5),now).groups.T2).toEqual({sends:50,bounces:5,rate:0.1});
});
it('does not invent old tiers; sent_ok overlaps T1, and old/other-org/draft rows do not count',()=>{
 const base=rows(1,1)[0];const metrics=tierMetrics('org',[{...base,recipient_tier_at_send:'T1',recipient_was_sent_ok:true},{...base,recipient_tier_at_send:null},
 {...base,org_id:'other'},{...base,status:'draft'},{...base,sent_at:'2026-01-01'}],now);
 expect(metrics.groups.T1.sends).toBe(1);expect(metrics.groups.sent_ok.sends).toBe(1);expect(metrics.unclassified).toBe(1);expect(metrics.groups.T2.sends).toBe(0);
});
