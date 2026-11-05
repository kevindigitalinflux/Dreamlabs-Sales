import {expect,it} from 'vitest';
import {emailEvidenceView,readEmailSendResponse,emailReleaseSummary} from './emailVerification';
it('shows the scoped latest check, hard-bounce precedence and expired evidence honestly',()=>{
 const now=Date.parse('2026-11-05');
 const rows=[{org_id:'org',address:'p@example.com',outcome:'checked_invalid',seen_at:'2026-11-04'}];
 expect(emailEvidenceView('org','p@example.com',rows,now).label).toBe('Our checker says this address does not exist');
 expect(emailEvidenceView('other','p@example.com',rows,now).label).toBe('Not confirmed');
 expect(emailEvidenceView('org','p@example.com',rows,now+15*86400000).label).toBe('Not confirmed');
});
it('reads blocked metadata from a non-2xx function response without consuming its body',async()=>{
 const response=new Response(JSON.stringify({error:'blocked',verification:{status:'invalid',label:'Our checker says this address does not exist'}}),{status:409});
 expect(await readEmailSendResponse(null,{context:response})).toMatchObject({ok:false,blocked:true,verification:{status:'invalid'}});
 expect(response.bodyUsed).toBe(false);
});
it('reports sent, blocked and not-confirmed counts separately',()=>{
 expect(emailReleaseSummary([{ok:true,blocked:false,verification:{status:'valid',label:'Confirmed'}},{ok:false,blocked:true},{ok:true,blocked:false,verification:{status:'unverifiable',label:'Not confirmed'}},{ok:false,blocked:false}]))
 .toBe('Sent 2; blocked 1; not confirmed 1; failed 1');
});
