import {afterEach,expect,it,vi} from 'vitest';
import {lookupMx} from '../../supabase/functions/_shared/dnsLookup';
afterEach(()=>vi.restoreAllMocks());
it('allows free-email MX checks only via the fixed DNS endpoint and never fetches the recipient domain',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({Status:0,Answer:[{type:15,data:'10 mx.gmail.com.'}]})));
 expect(await lookupMx('gmail.com')).toBe('error');expect(fetcher).not.toHaveBeenCalled();
 expect(await lookupMx('gmail.com',100,true)).toBe('mx');
 expect(String(fetcher.mock.calls[0][0])).toContain('https://cloudflare-dns.com/dns-query?name=gmail.com&type=MX');
});
it('retains hostname guards for malformed or internal mail domains',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch');
 for(const domain of ['localhost','127.0.0.1','mail.internal','gmail.com@127.0.0.1'])expect(await lookupMx(domain,100,true)).toBe('error');
 expect(fetcher).not.toHaveBeenCalled();
});
