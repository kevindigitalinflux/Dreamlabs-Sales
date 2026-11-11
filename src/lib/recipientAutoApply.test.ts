import {expect,it,vi} from 'vitest';
import {autoApplyRecipients,type AutoRecipient} from '../../supabase/functions/_shared/recipientAutoApply';
it('only applies T1/T2, never overwrites a typed email, and leaves enrollment consent alone',async()=>{
 const fill=vi.fn(async()=>true);const note=vi.fn();
 const candidates:AutoRecipient[]=[{address:'a@example.com',name:'Alex Brown',tier:{tier:'T1',reason:'Published',basis:'company_site'},savedEmail:''},
 {address:'b@example.com',name:'Mary Jones',tier:{tier:'T2',reason:'Two people',basis:'supported_pattern'},savedEmail:'typed@example.com'},
 {address:'c@example.com',name:'Weak',tier:{tier:'T3',reason:'Weak',basis:'weak_evidence'},savedEmail:''}];
 await autoApplyRecipients(candidates,fill,note);expect(fill).toHaveBeenCalledTimes(1);expect(note).toHaveBeenCalledWith('Added a@example.com: Published');
});
it('keeps dismissed/blocked and failed writes out of automatic notes',async()=>{
 const fill=vi.fn(async()=>false),note=vi.fn();await autoApplyRecipients([{address:'a@example.com',name:'A',tier:{tier:'T1',reason:'Known',basis:'checker_valid'},dismissed:true,savedEmail:''}],fill,note);
 expect(fill).not.toHaveBeenCalled();expect(note).not.toHaveBeenCalled();
});
