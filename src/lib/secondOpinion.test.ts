import {expect,it,vi} from 'vitest';
import {secondOpinion} from '../../supabase/functions/_shared/secondOpinion';
const address='alex.brown@example.com';
const evidence={forAddress:address,syntaxValid:true,hasMailServer:true,generated:true,roleNeedsReview:false,checker:'unverifiable' as const,
 pattern:{domain:'example.com',candidateMatches:true,t1Support:[{address:'mary.jones@example.com',personKey:'mary jones'},{address:'john.smith@example.com',personKey:'john smith'}]}};
function fixture(){const events:string[]=[];return {events,deps:{
 loadOwnKey:vi.fn(async()=>({orgId:'org',source:'org' as const,value:'fake-local-key'})),
 reserveUsage:vi.fn(async()=>{events.push('reserve');return {orgId:'org',id:'lease',day:'2026-11-11'};}),refundUsage:vi.fn(async()=>{events.push('refund');}),
 provider:{verify:vi.fn(async()=>{events.push('call');return {status:'valid' as const,catchAll:false,worked:true};})}}};}
it('is off by default and never loads a key or reserves',async()=>{
 const f=fixture();expect((await secondOpinion({orgId:'org',address,evidence,ownChecker:'unverifiable',providerKind:'hosted',dailyCap:10},f.deps)).called).toBe(false);
 expect(f.deps.loadOwnKey).not.toHaveBeenCalled();expect(f.events).toEqual([]);
});
it('reserves before a fake vendor and accepts valid only outside catch-all',async()=>{
 const f=fixture();const input={enabled:true,orgId:'org',address,evidence,ownChecker:'unverifiable' as const,providerKind:'hosted',dailyCap:10};
 expect((await secondOpinion(input,f.deps)).tier.tier).toBe('T1');expect(f.events).toEqual(['reserve','call']);
 f.deps.provider.verify.mockResolvedValueOnce({status:'valid',catchAll:true,worked:true});expect((await secondOpinion(input,f.deps)).tier.tier).toBe('T2');
});
it('refuses foreign/global credentials, insufficient caps and non-T2/settled addresses',async()=>{
 const f=fixture(),input={enabled:true,orgId:'org',address,evidence,ownChecker:'unverifiable' as const,providerKind:'unknown',dailyCap:10};
 for(const key of [{orgId:'other',source:'org',value:'fake'},{orgId:'org',source:'global',value:'fake'}]){f.deps.loadOwnKey.mockResolvedValueOnce(key as never);expect((await secondOpinion(input,f.deps)).called).toBe(false);}
 await secondOpinion({...input,dailyCap:0},f.deps);await secondOpinion({...input,ownChecker:'valid'},f.deps);
 await secondOpinion({...input,evidence:{...evidence,optedOut:true}},f.deps);expect(f.events).toEqual([]);
});
it('maps invalid/risky/unknown conservatively and refunds once only when no work is proven',async()=>{
 const f=fixture(),input={enabled:true,orgId:'org',address,evidence,ownChecker:'unverifiable' as const,providerKind:'unknown',dailyCap:10};
 for(const status of ['invalid','risky','unknown'] as const){f.deps.provider.verify.mockResolvedValueOnce({status,catchAll:false,worked:true} as never);expect((await secondOpinion(input,f.deps)).tier.tier).toBe(status==='invalid'?'never':'T2');}
 f.deps.provider.verify.mockResolvedValueOnce({status:'unknown',catchAll:false,worked:false} as never);await secondOpinion(input,f.deps);expect(f.deps.refundUsage).toHaveBeenCalledTimes(1);
 f.deps.provider.verify.mockRejectedValueOnce(Error('uncertain dispatch'));await secondOpinion(input,f.deps);expect(f.deps.refundUsage).toHaveBeenCalledTimes(1);
});
it('does not upgrade malformed catch-all proof or call a vendor after a refused reservation',async()=>{
 const f=fixture(),input={enabled:true,orgId:'org',address,evidence,ownChecker:'unverifiable' as const,providerKind:'hosted',dailyCap:10};
 f.deps.reserveUsage.mockResolvedValueOnce(null as never);expect((await secondOpinion(input,f.deps)).called).toBe(false);expect(f.deps.provider.verify).not.toHaveBeenCalled();
 f.deps.provider.verify.mockResolvedValueOnce({status:'valid',worked:true} as never);expect((await secondOpinion(input,f.deps)).tier.tier).toBe('T2');
});
