import {expect,it,vi} from 'vitest';
import {completeDeepFindRun,maintainDeepFind} from '../../supabase/functions/_shared/deepFindMaintenance';
it('delegates completion and stale recovery to atomic SQL rather than a read/then-write race',async()=>{
 const rpc=vi.fn(async()=>({data:false,error:null}));
 expect(await completeDeepFindRun({rpc},'run')).toBe(false);await maintainDeepFind({rpc});
 expect(rpc.mock.calls).toEqual([['deep_find_complete',{p_run:'run'}],['deep_find_housekeeping',{}]]);
});
it('does not report a failed SQL decision as successful completion',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{expect(await completeDeepFindRun({rpc:async()=>({error:{message:'private'}})},'run')).toBe(false);expect(log).toHaveBeenCalledWith('deep find: complete run failed');}finally{log.mockRestore()}
});
