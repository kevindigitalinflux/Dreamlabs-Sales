import {expect,it} from 'vitest';
import {classifyKeyFailure,KEY_PROVIDERS} from '../../supabase/functions/_shared/keyHealthRules';
it.each(['gemini','google_places','google_places_pro','companies_house','apollo','hunter','anthropic','opencorporates','cro','lookup_worker','firecrawl','email_verifier'])('classifies fixed HTTP outcomes for %s',provider=>{
 expect(KEY_PROVIDERS).toContain(provider);
 expect(classifyKeyFailure(provider,401,null)).toBe('refused');expect(classifyKeyFailure(provider,403,null)).toBe('refused');
 expect(classifyKeyFailure(provider,402,null)).toBe('needs_topup');expect(classifyKeyFailure(provider,429,'slow down')).toBe('rate_limited');
 for(const code of [0,200,400,404,500,503,504])expect(classifyKeyFailure(provider,code,null)).toBeNull();
});
it.each([
 ['gemini',{error:{status:'RESOURCE_EXHAUSTED',message:'Quota exceeded for daily requests'}},'rate_limited'],
 ['gemini',{error:{status:'RESOURCE_EXHAUSTED',message:'Too many requests per minute'}},'rate_limited'],
 ['hunter',{errors:[{id:'usage_limit_reached',details:'monthly searches exhausted'}]},'needs_topup'],
 ['hunter',{errors:[{id:'too_many_requests'}]},'rate_limited'],
 ['firecrawl',{error:'Insufficient credits'},'needs_topup'],
 ['apollo',{error:'credits exhausted'},'needs_topup'],
])('classifies %s quota separately from short throttling', (provider,hint,expected)=>expect(classifyKeyFailure(provider,429,hint)).toBe(expected));

// Google's per-minute response includes billing language even when no top-up is needed.
const geminiMinuteBody={"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"23s"}]}};
it('treats the exact Google per-minute quota response as a short rate limit',()=>{
 expect(classifyKeyFailure('gemini',429,geminiMinuteBody)).toBe('rate_limited');
 expect(classifyKeyFailure('gemini',429,JSON.stringify(geminiMinuteBody))).toBe('rate_limited');
});
it.each(['GenerateRequestsPerDayPerProjectPerModel-FreeTier','GenerateRequestsPerMonthPerProjectPerModel-FreeTier'])('requires top-up for explicit Gemini quota id %s',quotaId=>{
 const body=JSON.parse(JSON.stringify(geminiMinuteBody));body.error.details[0].violations[0].quotaId=quotaId;
 expect(classifyKeyFailure('gemini',429,body)).toBe('needs_topup');
});
it('recognises Gemini prepayment credits without generic billing inference',()=>{
 expect(classifyKeyFailure('gemini',429,{error:{message:'Your prepayment credits are depleted'}})).toBe('needs_topup');
});
it.each(['{"error":{"message":"check your billing',null,{error:{details:[{violations:[null,{quotaId:'PerSecond'}]}]}}])('treats truncated or unknown Gemini quota details as rate limited: %j',hint=>{
 expect(classifyKeyFailure('gemini',429,hint)).toBe('rate_limited');
});
