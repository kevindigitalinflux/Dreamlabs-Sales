import { expect, it } from 'vitest';
import { runControlState } from './runControlState';
it.each([
 ['active',null,0,['pause','stop']], ['paused',null,1,['pausing','stop']], ['paused',null,0,['resume','stop']],
 ['cancelled','stopped by user',0,['resume_stopped']], ['cancelled','failed',0,[]], ['completed',null,0,[]],
])('controls %s %s working=%s', (status,cancel_reason,working,expected) => {
 expect(runControlState({status,cancel_reason},Number(working),2)).toEqual(expected);
});
it('does not resume stopped run without queued leads',()=>expect(runControlState({status:'cancelled',cancel_reason:'stopped by user'},0,0)).toEqual([]));
