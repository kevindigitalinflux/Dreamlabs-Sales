import {MemoryRouter} from 'react-router';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
vi.mock('../hooks/useDeepFindRun',()=>({useDeepFindRun:()=>({run:{status:'active',gemini_refused_status:402},rows:[],loading:false,error:null})}));
vi.mock('../lib/deepFind',()=>({cancelDeepFind:vi.fn()}));
vi.mock('../components/deepfind/DeepFindLeadResult',()=>({DeepFindLeadResult:()=>null}));
import {DeepFindProgress} from '../components/deepfind/DeepFindProgress';
it('renders one fixed run warning rather than a warning for every row',()=>{
 const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(DeepFindProgress,{runId:'fixture'})));
 expect(html.match(/Gemini refused the key/g)).toHaveLength(1);expect(html).toContain('error 402');
});
