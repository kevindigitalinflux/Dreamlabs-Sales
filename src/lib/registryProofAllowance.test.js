import {expect,it} from 'vitest';
import {reserveRunRegistryProof} from '../../supabase/functions/_shared/registryProofAllowance';
import {replyDatabase} from './replyTestDatabase';
it('uses a separate durable JSON allowance once per lead with a fifty-lead cap',async()=>{
 const db=replyDatabase({deep_find_leads:[{id:'row',org_id:'org',run_id:'run',domains:{_verify_gate:{kept:true}}}]});
 const from=db.service.from;db.service.from=table=>{const q=from(table),eq=q.eq;q.eq=(key,value)=>key==='domains'?q:eq(key,value);return q;};
 expect(await reserveRunRegistryProof(db.service,'org','run','lead')).toBe(true);
 expect(await reserveRunRegistryProof(db.service,'org','run','lead')).toBe(false);
 expect(db.tables.deep_find_leads[0].domains._verify_gate).toEqual({kept:true});
 db.tables.deep_find_leads[0].domains._registry_proof=Array.from({length:50},(_,i)=>String(i));
 expect(await reserveRunRegistryProof(db.service,'org','run','new')).toBe(false);
});
