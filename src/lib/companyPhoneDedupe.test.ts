import { expect, it } from 'vitest';
import { dedupeCompanyPhones } from '../../supabase/functions/_shared/phoneNumbers';
it('offers one switchboard suggestion while retaining distinct direct lines', () => {
 const company={name:'Jane Smith',field:'person_phone',value:'+442079460958',label:'Ask for Jane',phone:{kind:'company_line'}};
 const result=dedupeCompanyPhones([company,{...company,name:'John Smith'},{...company,name:'Jane Smith',value:'+442079460959',phone:{kind:'direct'}}]);
 expect(result).toHaveLength(2); expect(result[0].name).toBe('Company line'); expect(result[0].label).not.toContain('Jane');
});
