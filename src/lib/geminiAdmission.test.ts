import {expect,it,vi} from 'vitest';
import {admitGemini, claimRunNotice} from '../../supabase/functions/_shared/geminiAdmission';
import {geminiGroundedSearch,geminiJson} from '../../supabase/functions/_shared/ai';
it('blocks both Gemini transports before HTTP and monthly counting when SQL is busy',async()=>{
 const rpc=vi.fn(async()=>({data:false})), context={service:{rpc},orgId:'o',sharedKey:false};
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('unexpected'));
 try {
  await expect(geminiGroundedSearch('fixture','fake',1000,context)).rejects.toThrow('busy');
  await expect(geminiJson('fixture','fake',1000,context)).rejects.toThrow('busy');
  expect(fetcher).not.toHaveBeenCalled();expect(rpc.mock.calls).toEqual([['gemini_admit',{}],['gemini_admit',{}]]);
 } finally {fetcher.mockRestore();}
});
it('uses the shared atomic guard and refuses busy without dispatching Gemini',async()=>{
 const rpc=vi.fn(async()=>({data:false}));
 await expect(admitGemini({service:{rpc},orgId:'org',sharedKey:false})).rejects.toThrow('Gemini 429: busy');
 expect(rpc).toHaveBeenCalledWith('gemini_admit',{});
});
it('fails closed on admission errors and claims a daily notice through SQL',async()=>{
 await expect(admitGemini({service:{rpc:async()=>({error:'private'})},orgId:'o',sharedKey:false})).rejects.toThrow('Gemini 429: busy');
 const rpc=vi.fn(async()=>({data:false}));expect(await claimRunNotice({rpc},'run','worker_scrape')).toBe(false);
 expect(rpc).toHaveBeenCalledWith('deep_find_notice_once',{p_run:'run',p_code:'worker_scrape'});
});
