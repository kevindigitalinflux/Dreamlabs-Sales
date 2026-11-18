import {expect,it} from 'vitest';
import {classifyKeyFailure,KEY_PROVIDERS} from '../../supabase/functions/_shared/keyHealthRules';
it.each(['gemini','google_places','google_places_pro','companies_house','apollo','hunter','anthropic','opencorporates','cro','lookup_worker','firecrawl','email_verifier'])('classifies fixed HTTP outcomes for %s',provider=>{
 expect(KEY_PROVIDERS).toContain(provider);
 expect(classifyKeyFailure(provider,401,null)).toBe('refused');expect(classifyKeyFailure(provider,403,null)).toBe('refused');
 expect(classifyKeyFailure(provider,402,null)).toBe('needs_topup');expect(classifyKeyFailure(provider,429,'slow down')).toBe('rate_limited');
 for(const code of [0,200,400,404,500,503,504])expect(classifyKeyFailure(provider,code,null)).toBeNull();
});
it.each([
 ['gemini',{error:{status:'RESOURCE_EXHAUSTED',message:'Quota exceeded for daily requests'}},'needs_topup'],
 ['gemini',{error:{status:'RESOURCE_EXHAUSTED',message:'Too many requests per minute'}},'rate_limited'],
 ['hunter',{errors:[{id:'usage_limit_reached',details:'monthly searches exhausted'}]},'needs_topup'],
 ['hunter',{errors:[{id:'too_many_requests'}]},'rate_limited'],
 ['firecrawl',{error:'Insufficient credits'},'needs_topup'],
 ['apollo',{error:'credits exhausted'},'needs_topup'],
])('classifies %s quota separately from short throttling', (provider,hint,expected)=>expect(classifyKeyFailure(provider,429,hint)).toBe(expected));
