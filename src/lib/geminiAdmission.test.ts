import {expect,it,vi} from 'vitest';
import {admitGemini, claimRunNotice} from '../../supabase/functions/_shared/geminiAdmission';
import {geminiGroundedSearch,geminiJson} from '../../supabase/functions/_shared/ai';
it('blocks both Gemini transports before HTTP and monthly counting when SQL is busy',async()=>{
 const rpc=vi.fn(async()=>({data:false})), context={service:{rpc},orgId:'o',sharedKey:false,runId:'run'};
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('unexpected'));
 try {
  await expect(geminiGroundedSearch('fixture','fake',1000,context)).rejects.toThrow('busy');
  await expect(geminiJson('fixture','fake',1000,context)).rejects.toThrow('busy');
  expect(fetcher).not.toHaveBeenCalled();expect(rpc.mock.calls).toEqual([['gemini_run_status',{p_run:'run'}],['gemini_admit',{p_org:'o'}],['gemini_run_status',{p_run:'run'}],['gemini_admit',{p_org:'o'}]]);
 } finally {fetcher.mockRestore();}
});
it('uses the shared atomic guard and refuses busy without dispatching Gemini',async()=>{
 const rpc=vi.fn(async()=>({data:false}));
 await expect(admitGemini({service:{rpc},orgId:'org',sharedKey:false,runId:'run'})).rejects.toThrow('Gemini 429: busy');
 expect(rpc).toHaveBeenCalledWith('gemini_admit',{p_org:'org'});
});
it('fails closed on admission errors and claims a daily notice through SQL',async()=>{
 await expect(admitGemini({service:{rpc:async()=>({error:'private'})},orgId:'o',sharedKey:false,runId:'run'})).rejects.toThrow('Gemini 429: busy');
 const rpc=vi.fn(async()=>({data:false}));expect(await claimRunNotice({rpc},'run','worker_scrape')).toBe(false);
 expect(rpc).toHaveBeenCalledWith('deep_find_notice_once',{p_run:'run',p_code:'worker_scrape'});
});

it('sends the Deep find organisation to admission and isolates refused organisations',async()=>{
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>({data:name==='gemini_run_status'?null:args.p_org!=='org-a'}));
 await expect(admitGemini({service:{rpc},orgId:'org-a',runId:'run-a',sharedKey:false})).rejects.toThrow('Gemini 429: busy');
 await expect(admitGemini({service:{rpc},orgId:'org-b',runId:'run-b',sharedKey:false})).resolves.toBeUndefined();
 expect(rpc).toHaveBeenCalledWith('gemini_admit',{p_org:'org-a'});expect(rpc).toHaveBeenCalledWith('gemini_admit',{p_org:'org-b'});
});
it('does not admit a context with only an organisation or only a run',async()=>{
 const rpc=vi.fn(async()=>({error:'unavailable'}));
 await admitGemini({service:{rpc},orgId:'org',sharedKey:false});
 await admitGemini({service:{rpc},orgId:'',runId:'run',sharedKey:false});
 expect(rpc).not.toHaveBeenCalled();
});
it('fails closed as busy on a thrown admission RPC without dispatching',async()=>{
 const rpc=vi.fn(async(name:string)=>{if(name==='gemini_run_status')return {data:null};throw Error('private');});
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('unexpected'));
 try {await expect(geminiGroundedSearch('fixture','fake',1000,{service:{rpc},orgId:'org',runId:'run',sharedKey:false})).rejects.toThrow('Gemini 429: busy');expect(fetcher).not.toHaveBeenCalled();}
 finally {fetcher.mockRestore();}
});
