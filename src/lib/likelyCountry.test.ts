import {expect,it} from 'vitest';
import {likelyCountry} from '../../supabase/functions/_shared/likelyCountry';

it.each([
 [{phone:'+1 (512) 555-0100'},'non_GB'],
 [{address:'123 Main St, Austin, Texas 78701'},'non_GB'],
 [{address:'Austin, TX 78701-1234'},'non_GB'],
 [{additional_phones:['invalid','+353 1 234 5678']},'non_GB'],
 [{postcode:'SW1A 1AA'},'GB'],
 [{address:'London SW1A 1AA'},'GB'],
 [{phone:'+44 20 7946 0000'},'GB'],
 [{website:'https://fixture.co.uk'},'GB'],
 [{website:'https://fixture.uk'},'GB'],
 [{website:'https://fixture.com'},'unknown'],
 [{phone:'020 7946 0000'},'unknown'],
 [{country:'GB',phone:'+1 (512) 555-0100',website:'https://fixture.com'},'GB'],
 [{country:'IE',postcode:'SW1A 1AA'},'non_GB'],
 [{phone:'+1 (512) 555-0100',postcode:'SW1A 1AA'},'non_GB'],
 [{},'unknown'],
])('infers saved location %# without changing the lead',(lead,expected)=>{
 const before=JSON.stringify(lead);expect(likelyCountry(lead)).toBe(expected);expect(JSON.stringify(lead)).toBe(before);
});
