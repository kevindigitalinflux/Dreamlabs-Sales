import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {MemoryRouter} from 'react-router';
import {KeyHealthBannerView} from '../components/settings/KeyHealthBannerView';
import {KeyHealthFlag} from '../components/settings/KeyHealthFlag';
const row={org_id:'a',provider:'gemini',state:'needs_topup',status_code:402,key_source:'global',feature:'deep_find',first_failed_at:'2026-11-18T10:00:00Z',last_failed_at:'2026-11-18T10:00:00Z',failure_count:1};
const render=node=>renderToStaticMarkup(createElement(MemoryRouter,null,node));
it('shows actionable admin copy and softer member copy with no admin link',()=>{
 const admin=render(createElement(KeyHealthBannerView,{rows:[row],admin:true,onDismiss:()=>{}}));expect(admin).toContain('Gemini key needs attention');expect(admin).toContain('Fix this key');expect(admin).toContain('/settings/organization#gemini');
 const member=render(createElement(KeyHealthBannerView,{rows:[row],admin:false,onDismiss:()=>{}}));expect(member).toContain('Some Gemini features are paused. Ask an admin');expect(member).not.toContain('Fix this key');
});
it('flags a shared key even without a saved key and withholds the billing link from non-platform owners',()=>{
 const html=render(createElement(KeyHealthFlag,{row,platformOwner:false}));expect(html).toContain('Billing or credit needs attention.');expect(html).toContain('platform');expect(html).toContain('Deep find');expect(html).toContain('Since');expect(html).not.toContain('ai.studio');
 expect(render(createElement(KeyHealthFlag,{row,platformOwner:true}))).toContain('https://ai.studio/projects');
});
import {KeyHealthSection} from '../components/settings/KeyHealthSection';
it('opens the flagged section and an unflagged hash target, while unrelated healthy sections stay folded',()=>{
 const child=createElement('p',null,'Fixture section body');
 const flagged=render(createElement(KeyHealthSection,{provider:'gemini',title:'Gemini',row,children:child}));expect(flagged).toContain('aria-expanded="true"');expect(flagged).toContain('Fixture section body');
 const target=renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:['/settings/organization#hunter']},createElement(KeyHealthSection,{provider:'hunter',title:'Hunter',children:child})));expect(target).toContain('aria-expanded="true"');
 const folded=render(createElement(KeyHealthSection,{provider:'hunter',title:'Hunter',children:child}));expect(folded).toContain('aria-expanded="false"');expect(folded).not.toContain('Fixture section body');
});
