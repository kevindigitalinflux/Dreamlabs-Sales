import {classifyHunter429} from './hunterLimits.ts';

export const KEY_PROVIDERS = ['gemini','google_places','google_places_pro','companies_house','apollo','hunter','anthropic','opencorporates','cro','lookup_worker','firecrawl','email_verifier'] as const;
export type KeyProvider = typeof KEY_PROVIDERS[number];
export type KeyState = 'refused' | 'needs_topup' | 'rate_limited';
export type KeyFeature = 'deep_find' | 'role_search' | 'drafting' | 'scrape' | 'key_test' | 'reply_drafting' | 'note_parsing' | 'enrichment' | 'verification' | 'lookup' | 'research' | 'sequence' | 'csv_parsing' | 'icp_parsing';
export const KEY_PROVIDER_COPY: Record<KeyProvider,{name:string; refusedBy:string; billing:string|null}> = {
  gemini:{name:'Gemini',refusedBy:'Google',billing:'https://ai.studio/projects'},
  google_places:{name:'Google Places',refusedBy:'Google',billing:'https://console.cloud.google.com/billing'},
  google_places_pro:{name:'Google Places Pro',refusedBy:'Google',billing:'https://console.cloud.google.com/billing'},
  companies_house:{name:'Companies House',refusedBy:'Companies House',billing:'https://developer.company-information.service.gov.uk/'},
  apollo:{name:'Apollo',refusedBy:'Apollo',billing:'https://app.apollo.io/#/settings/plans'},
  hunter:{name:'Hunter',refusedBy:'Hunter',billing:'https://hunter.io/users/sign_in'},
  anthropic:{name:'Anthropic',refusedBy:'Anthropic',billing:'https://console.anthropic.com/settings/billing'},
  opencorporates:{name:'OpenCorporates',refusedBy:'OpenCorporates',billing:'https://opencorporates.com/api_accounts'},
  cro:{name:'CRO',refusedBy:'CRO',billing:'https://services.cro.ie/'},
  lookup_worker:{name:'Lookup worker',refusedBy:'The lookup worker',billing:null},
  firecrawl:{name:'Firecrawl',refusedBy:'Firecrawl',billing:'https://www.firecrawl.dev/app'},
  email_verifier:{name:'Email verifier',refusedBy:'The email verifier',billing:null},
};

/** Read provider hints only in memory; callers persist only the returned fixed state. */
export function classifyKeyFailure(provider: string,status: number,bodyHint: unknown): KeyState|null {
  if (!KEY_PROVIDERS.includes(provider as KeyProvider)) return null;
  if (status===401 || status===403) return 'refused';
  if (status===402) return 'needs_topup';
  if (status!==429) return null;
  if (provider==='hunter') return classifyHunter429(bodyHint)==='usage_exhausted' ? 'needs_topup':'rate_limited';
  let hint='';
  try {hint=(typeof bodyHint==='string'?bodyHint:JSON.stringify(bodyHint)??'').slice(0,4000);} catch {return 'rate_limited';}
  const exhausted=/credits?|billing|balance|payment|quota.{0,80}(?:exceed|exhaust|used|reached)|(?:exceed|exhaust|used).{0,80}quota|daily.{0,50}limit|monthly.{0,50}limit/i.test(hint);
  const shortRate=/(?:per |\/)(?:minute|second)|rate.?limit|too many requests/i.test(hint);
  return exhausted && (!shortRate || /credits?|billing|balance|daily|monthly/i.test(hint)) ? 'needs_topup':'rate_limited';
}

/** Links target a single provider section without including credentials or provider response text. */
export function keySectionHref(provider: KeyProvider): string {return `/settings/organization#${provider}`;}

/** Fixed user-facing wording, shared by flags, banners and popups. */
export function keyHealthReason(provider: KeyProvider,state: KeyState): string {
  return state==='refused'?`${KEY_PROVIDER_COPY[provider].refusedBy} refused this key.`
    :state==='needs_topup'?'Billing or credit needs attention.':'Busy right now, will retry.';
}
