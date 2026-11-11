import {expect,it} from 'vitest';
import {readComplete} from '../../supabase/functions/_shared/readComplete';
import {replyDatabase} from './replyTestDatabase';
it('reads beyond a thousand rows and rejects a failed complete read',async()=>{
 const db=replyDatabase({email_logs:Array.from({length:1001},(_,i)=>({id:String(i)}))});
 expect((await readComplete(()=>db.service.from('email_logs').select('*',{count:'exact'}))).data).toHaveLength(1001);
 db.failures.add('email_logs:select');await expect(readComplete(()=>db.service.from('email_logs').select('*',{count:'exact'}))).rejects.toThrow('completely');
});
