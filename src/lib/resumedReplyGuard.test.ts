import {expect,it} from 'vitest';
import {classifyLead,endOfLocalDay} from '../../supabase/functions/_shared/autopilotEligibility';
it('never resumes outreach to a replied lead even when its sequence is due',()=>{
 const now=new Date('2026-10-28T12:00:00Z');
 expect(classifyLead({id:'lead',stage:'replied',opted_out:false,email:'local@example.invalid',last_contacted_at:null},{status:'active',next_send_at:'2026-10-27T12:00:00Z'},new Set(),endOfLocalDay(now,'Europe/London'),now).eligible).toBe(false);
});
