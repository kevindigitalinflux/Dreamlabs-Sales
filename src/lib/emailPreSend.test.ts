import {expect,it,vi} from 'vitest';
import {makeEmailPrechecker} from '../../supabase/functions/_shared/emailPreSend';
declare global { namespace Deno { namespace env { function get(name:string):string|undefined; } } }
it('refuses placeholders before history, DNS or worker calls',async()=>{
 const from=vi.fn(()=>{throw Error('History must not be read');}),mx=vi.fn(),worker={verifyEmail:vi.fn(),msExists:vi.fn(),scrapeSite:vi.fn(),lines:()=>[]};
 const check=makeEmailPrechecker({from} as never,'org',{worker,lookupMx:mx});
 expect(await check({address:'a@domain.com'})).toEqual({status:'invalid',label:'This is a placeholder address, not a real mailbox',overridable:false});
 expect(from).not.toHaveBeenCalled();expect(mx).not.toHaveBeenCalled();expect(worker.verifyEmail).not.toHaveBeenCalled();
});
