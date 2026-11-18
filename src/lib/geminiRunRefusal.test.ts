import {afterEach,expect,it,vi} from 'vitest';
import {geminiGroundedSearch} from '../../supabase/functions/_shared/ai';
import {geminiRefusalLine} from '../../supabase/functions/_shared/geminiAdmission';
afterEach(()=>vi.unstubAllGlobals());
it.each([401,402,403])('stops the next lead after HTTP %i without another Gemini request',async status=>{
 let refusal:number|null=null;const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
  if(name==='gemini_run_status'){if(args.p_status)refusal??=args.p_status as number;return {data:refusal};}
  return {data:true};
 });
 const f=vi.fn(async()=>Response.json({}, {status}));vi.stubGlobal('fetch',f);
 const onRefused=vi.fn(),context={service:{rpc},orgId:'org',sharedKey:false,runId:'run',onRefused};
 await expect(geminiGroundedSearch('first lead','fixture',1000,context)).rejects.toThrow(`Gemini ${status}`);
 await expect(geminiGroundedSearch('second lead','fixture',1000,{...context})).rejects.toThrow(`Gemini ${status}`);
 expect(f).toHaveBeenCalledTimes(1);expect(refusal).toBe(status);
 expect(geminiRefusalLine(status)).toBe(`Web search and role search skipped: Gemini refused the key (error ${status}). Check the Gemini billing or key.`);
});
it('does not stop the run on HTTP 429',async()=>{
 const rpc=vi.fn(async(name:string,_args:Record<string,unknown>)=>({data:name==='gemini_run_status'?null:true}));
 const f=vi.fn(async()=>Response.json({}, {status:429}));vi.stubGlobal('fetch',f);
 const context={service:{rpc},orgId:'org',sharedKey:false,runId:'run'};
 for(let i=0;i<2;i++)await expect(geminiGroundedSearch('fixture','fixture',1000,context)).rejects.toThrow('429');
 expect(f).toHaveBeenCalledTimes(2);expect(rpc.mock.calls.some(([n,a])=>n==='gemini_run_status'&&a.p_status)).toBe(false);
});
