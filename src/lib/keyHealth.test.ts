import {expect,it,vi} from 'vitest';
import type {HealthService} from '../../supabase/functions/_shared/keyHealth';
import {createKeyHealthInvocation,recordKeyFailure,recordKeyOk} from '../../supabase/functions/_shared/keyHealth';
const scope=(rpc:HealthService['rpc'],orgId='org',invocation=createKeyHealthInvocation())=>({service:{rpc},orgId,provider:'gemini' as const,keySource:'org' as const,feature:'deep_find' as const,invocation});
it('memoises successful clears once per invocation/org/provider, including overlapping completions',async()=>{
 const rpc=vi.fn(async()=>({data:true})),invocation=createKeyHealthInvocation(),a=scope(rpc,'a',invocation),b=scope(rpc,'b',invocation);
 await Promise.all([recordKeyOk(a),recordKeyOk(a),recordKeyOk(b)]);
 expect(rpc).toHaveBeenCalledTimes(2);await recordKeyOk(scope(rpc,'a'));expect(rpc).toHaveBeenCalledTimes(3);
});
it('never breaks the feature on thrown/rejected health RPCs and logs fixed codes only',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{}),rpc=vi.fn(async()=>{throw Error('private body or secret')});
 try{await expect(recordKeyFailure(scope(rpc),402,{error:'private body'})).resolves.toBeUndefined();await expect(recordKeyOk(scope(rpc))).resolves.toBeUndefined();expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|secret/);}finally{log.mockRestore()}
});
it('stores fixed fields only and ignores non-key failures',async()=>{
 const rpc=vi.fn(async()=>({data:true})),context=scope(rpc);
 await recordKeyFailure(context,402,'private prompt key URL');await recordKeyFailure(context,503,'private');
 expect(rpc).toHaveBeenCalledExactlyOnceWith('api_key_failure',{p_org:'org',p_provider:'gemini',p_state:'needs_topup',p_code:402,p_source:'org',p_feature:'deep_find'});
});
it('logs returned database errors without rejecting or exposing their contents',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{}),rpc=vi.fn(async()=>({error:{message:'private key URL'}}));
 try{await expect(recordKeyFailure(scope(rpc),401)).resolves.toBeUndefined();await expect(recordKeyOk(scope(rpc))).resolves.toBeUndefined();expect(log.mock.calls).toEqual([['api_key_health_write_failed'],['api_key_health_write_failed']]);}finally{log.mockRestore()}
});
