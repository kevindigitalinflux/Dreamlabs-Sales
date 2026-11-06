import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {BulkActionBar} from '../components/ui/BulkActionBar';
it('shows disabled bulk actions for empty selection without changing legacy hidden controls',()=>{
 const props={count:0,busy:false,approveLabel:'Apply selected',rejectLabel:'Dismiss selected',onApprove:()=>{},onReject:()=>{},onClear:()=>{}};
 expect(renderToStaticMarkup(createElement(BulkActionBar,props))).toBe('');
 const html=renderToStaticMarkup(createElement(BulkActionBar,{...props,showEmpty:true}));
 expect(html).toContain('disabled=""');expect(html).toContain('Apply selected');expect(html).toContain('Dismiss selected');
});
