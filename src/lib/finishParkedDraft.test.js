import {beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({client:null}));
vi.mock('./supabase',()=>({supabase:{from:(...args)=>mock.client.from(...args)}}));
import {finishParkedDraft} from './finishParkedDraft';
import {replyDatabase} from './replyTestDatabase';
let db;
const log={id:'draft',subject:'Fixture subject',sequence_enrollment_id:'enrollment'};
beforeEach(()=>{db=replyDatabase({email_logs:[{id:'draft',status:'sent'}],sequence_enrollments:[{id:'enrollment',lead_id:'lead',status:'active',current_step:2,
 sequence:{steps:[1,2,3].map(()=>({delay_days:1}))}}]});mock.client=db.service;});
it('runs the existing conditional advance and note path after a confirmed parked send',async()=>{
 const enroll=vi.fn();expect(await finishParkedDraft({id:'lead'},log,'sequence','sender',enroll)).toEqual({error:null,sent:true});
 expect(db.tables.sequence_enrollments[0].current_step).toBe(3);expect(enroll).not.toHaveBeenCalled();
 expect(db.tables.lead_notes).toHaveLength(1);
});
it('does not advance or enroll when the draft was not sent',async()=>{
 db.tables.email_logs[0].status='draft';const enroll=vi.fn();expect(await finishParkedDraft({id:'lead'},log,'sequence','sender',enroll)).toEqual({error:null,sent:false});
 expect(db.writes).toEqual([]);expect(enroll).not.toHaveBeenCalled();
});
it('reports follow-up failure without undoing a sent message',async()=>{
 db.failures.add('sequence_enrollments:select');expect(await finishParkedDraft({id:'lead'},log,'sequence','sender',vi.fn())).toMatchObject({sent:true,error:expect.stringContaining('Email sent')});
 expect(db.tables.email_logs[0].status).toBe('sent');
});
