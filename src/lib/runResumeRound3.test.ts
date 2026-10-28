import {expect,it,vi,afterEach} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {selectedRunBounds, selectedRunDecision} from '../../supabase/functions/_shared/runPauseRules';
import {RunControls} from '../components/autopilot/RunControls';
const now=new Date('2026-10-28T21:00:00Z');
const run={status:'active',cancel_reason:null,resumed_at:'2026-10-28T12:00:00Z',window_date:'2026-10-27',window_start:'09:00',window_end:'17:00',timezone:'Europe/London',outreach_sent_total:0,actual_ai_cost_cents:0,daily_send_cap:10,max_total_spend_cents:100};
const state={now,bounds:{startUtc:new Date('2026-10-28T09:00:00Z'),endUtc:new Date('2026-10-28T17:00:00Z')},runStartedAt:new Date('2026-10-27T08:00:00Z'),sentTotal:0,sendCap:10,spentCents:0,spendCap:100,queuedCount:2,workingCount:0};
afterEach(()=>vi.restoreAllMocks());
it.each([['send',{sentTotal:10},'complete_send_cap'],['spend',{spentCents:100},'complete_spend_cap']] as const)('finishes resumed %s cap even outside window',(_label,patch,expected)=>{
 expect(selectedRunDecision({...state,...patch},true)).toBe(expected);
});
it('resumed window waits with queue when no cap was hit',()=>expect(selectedRunDecision(state,true)).toBe('wait'));
it('non-resumed window still completes',()=>expect(selectedRunDecision(state,false)).toBe('complete_window_closed'));
it.each([
 ['Europe/London','2026-10-28T09:00:00.000Z'],
 ['Pacific/Auckland','2026-10-28T20:00:00.000Z'],
 [null,'2026-10-28T09:00:00.000Z'],
])('resumed window uses today in %s', (timezone,expected)=>{
 expect(selectedRunBounds({...run,timezone},now)?.startUtc.toISOString()).toBe(expected);
});
function html(patch:object={}) {
 vi.spyOn(Date,'now').mockReturnValue(now.getTime());
 return renderToStaticMarkup(createElement(RunControls,{run:{...run,...patch} as never,rows:[],canControl:true,onControl:async()=>null}));
}
it.each([
 [{outreach_sent_total:10},'This run has reached its send allowance and will finish shortly'],
 [{actual_ai_cost_cents:100},'This run has reached its spend cap and will finish shortly'],
])('cap status announces imminent finish', (patch,text)=>expect(html(patch)).toContain(text));
it('closed resumed window announces next window and Stop',()=>{
 const rendered=html();expect(rendered).toContain('continue at the next send window');expect(rendered).toContain('Stop');
});
it('UI shares the run timezone with the engine',()=>{
 const rendered=html({timezone:'Pacific/Auckland'});expect(rendered).not.toContain('Waiting for');expect(rendered).not.toContain('continue at the next send window');
});
