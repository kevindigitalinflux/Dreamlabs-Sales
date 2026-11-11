import {expect,it} from 'vitest';
import {mailboxReputation} from '../../supabase/functions/_shared/mailboxReputation';
it('pauses at 5 percent with twenty sends, never below twenty, and excludes other mailboxes and old sends',()=>{
 const now=Date.parse('2026-11-11T12:00:00Z');
 const logs=Array.from({length:20},(_,i)=>({sent_by:'sender',status:'sent',sent_at:new Date(now-3600000).toISOString(),hard_bounced_at:i===0?new Date(now).toISOString():null}));
 expect(mailboxReputation(logs,'sender',now)).toMatchObject({sends:20,bounces:1,paused:true});
 expect(mailboxReputation(logs.slice(1),'sender',now).paused).toBe(false);
 expect(mailboxReputation(logs,'other',now).sends).toBe(0);
 expect(mailboxReputation(logs,'sender',now+8*86400000).sends).toBe(0);
});
