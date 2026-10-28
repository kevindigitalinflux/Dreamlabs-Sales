import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
vi.mock('./supabase',()=>({supabase:{}}));
vi.mock('../hooks/useReplyAlerts',()=>({useReplyAlerts:()=>({alerts:[],markRead:async()=>null})}));
import {ReplyDetail} from '../components/emails/ReplyDetail';
it('reads reply before actions and original, with address-labelled compact metadata',()=>{
 const reply={id:'r',lead_id:'l',lead:{business_name:'Fixture business',stage:'replied'},subject:'Fixture subject',from_email:'local@example.invalid',received_at:'2026-10-28T12:00:00Z',body:'Fixture reply text',message_id:'<r>',original:{subject:'Fixture original',body:'Original body',sent_at:'2026-10-27T12:00:00Z'},attachment_count:0};
 const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(ReplyDetail,{reply:reply as never,onChanged:()=>{}})));
 const ordered=['Back to replies','Fixture business','Fixture subject','From ','Fixture reply text','Draft an answer with AI','Show original email'];
 for(let i=1;i<ordered.length;i++)expect(html.indexOf(ordered[i])).toBeGreaterThan(html.indexOf(ordered[i-1]));
 expect(html.indexOf('Open lead')).toBeLessThan(html.indexOf('Fixture reply text'));
 expect(html).not.toContain('<details open');
});
