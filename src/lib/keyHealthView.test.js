import {expect,it} from 'vitest';
import {visibleKeyHealth,problemKey,keyPopupPlans,activeKeyAlerts} from './keyHealthView';
import {keySectionHref} from '../../supabase/functions/_shared/keyHealthRules';
const row={org_id:'a',provider:'gemini',state:'needs_topup',status_code:402,key_source:'global',feature:'deep_find',first_failed_at:'2026-11-18T10:00:00Z',last_failed_at:'2026-11-18T10:00:00Z',failure_count:1};
it('hides stale rate limits and foreign/malformed rows without hiding persistent billing problems',()=>{
 expect(visibleKeyHealth([row,{...row,org_id:'b'},{...row,state:'bad'}],'a',Date.parse('2026-11-18T10:16:00Z'))).toEqual([row]);
 expect(visibleKeyHealth([{...row,state:'rate_limited'}],'a',Date.parse('2026-11-18T10:16:00Z'))).toEqual([]);
 expect(visibleKeyHealth([{...row,state:'rate_limited',last_failed_at:'2026-11-18T10:02:00Z'}],'a',Date.parse('2026-11-18T10:16:00Z'))).toHaveLength(1);
});
it('dismissal lasts for this problem only and returns for a new first_failed_at',()=>{
 const dismissed=new Set([problemKey(row)]);expect(activeKeyAlerts([row],dismissed)).toEqual([]);
 expect(activeKeyAlerts([{...row,first_failed_at:'2026-11-18T11:00:00Z'}],dismissed)).toHaveLength(1);
});
it('plans one popup per problem only for opted-in admins with granted permission',()=>{
 const context={admin:true,enabled:true,permission:'granted',seen:new Set()};
 expect(keyPopupPlans([row,row],context)).toHaveLength(1);
 expect(keyPopupPlans([row],{...context,admin:false})).toEqual([]);expect(keyPopupPlans([row],{...context,permission:'default'})).toEqual([]);
 expect(keyPopupPlans([row],{...context,seen:new Set([problemKey(row)])})).toEqual([]);
 expect(keySectionHref('gemini')).toBe('/settings/organization#gemini');
});
