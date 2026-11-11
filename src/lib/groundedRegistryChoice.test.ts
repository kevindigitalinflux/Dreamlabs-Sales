import {expect,it} from 'vitest';
import {groundedRegistryChoice} from '../../supabase/functions/_shared/groundedRegistryChoice';
const loc={postcode:null,city:null,address:null};
const company={company_number:'12345678',name:'Acme Limited',status:'active',address:null,postcode:null,locality:null,created:null,score:1};
it('accepts only a unique active name match from CH search, backed by grounded proof',()=>{
 expect(groundedRegistryChoice([company],'Acme',loc,['12345678'])).toBe(company);
 expect(groundedRegistryChoice([company],'Acme',loc,['87654321'])).toBeNull();
 expect(groundedRegistryChoice([{...company,status:'dissolved'}],'Acme',loc,['12345678'])).toBeNull();
 expect(groundedRegistryChoice([company,{...company,company_number:'87654321'}],'Acme',loc,['12345678'])).toBeNull();
 expect(groundedRegistryChoice([company],'Other business',loc,['12345678'])).toBeNull();
 expect(groundedRegistryChoice([company],'Acme',{...loc,postcode:'SW1A 1AA'},['12345678'])).toBeNull();
});
