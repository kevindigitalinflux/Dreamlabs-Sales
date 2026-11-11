import {expect,it} from 'vitest';
import {sentOkAddresses,tierSnapshot} from '../../supabase/functions/_shared/sentRecipientEvidence';
it('requires a genuine sent log aged at least 72 hours with no hard bounce',()=>{
 const now=Date.parse('2026-11-11T12:00:00Z');
 const base={org_id:'org',to_email:'alex@example.com',status:'sent',sent_at:new Date(now-72*3600000).toISOString()};
 expect(sentOkAddresses('org',[base],[],now)).toEqual(['alex@example.com']);
 for(const patch of [{status:'draft'},{org_id:'other'},{hard_bounced_at:base.sent_at},{sent_at:new Date(now-71*3600000).toISOString()}])expect(sentOkAddresses('org',[{...base,...patch}],[],now)).toEqual([]);
 expect(sentOkAddresses('org',[base],[{org_id:'org',address:base.to_email,outcome:'bounced_hard'}],now)).toEqual([]);
});
it('produces a complete immutable-at-send 074 snapshot and never calls a manual override T1',()=>{
 const at='2026-11-11T12:00:00Z';
 expect(tierSnapshot({tier:'T1',basis:'sent_ok',reason:'Delivered'},true,at)).toMatchObject({recipient_tier_at_send:'T1',recipient_tier_basis:'sent_ok',recipient_tier_version:1,recipient_was_sent_ok:true,recipient_tier_recorded_at:at});
 expect(tierSnapshot({tier:'never',basis:'checker_invalid',reason:'Invalid'},false,at)).toMatchObject({recipient_tier_at_send:'T3',recipient_was_sent_ok:false});
});
