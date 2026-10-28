import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReadinessBadge } from '../components/pipeline/ReadinessBadge';
import { RunLeadGroups } from '../components/autopilot/RunLeadGroups';
it('readiness has an icon as well as a colour', () => {
 const html=renderToStaticMarkup(createElement(ReadinessBadge,{readiness:'ready'}));
 expect(html).toContain('<svg'); expect(html).toContain('text-stage-won');
});
it('run groups expose accessible disclosure controls', () => {
 const rows=Array.from({length:9},(_,i)=>({id:String(i),status:'queued',reason:null,lead:null,resolution:'open'}));
 const html=renderToStaticMarkup(createElement(RunLeadGroups,{rows:rows as never,loading:false,error:null}));
 expect(html).toContain('aria-expanded="false"'); expect(html).toContain('aria-controls=');
});
