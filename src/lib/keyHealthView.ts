import {KEY_PROVIDERS,KEY_PROVIDER_COPY,keySectionHref,keyHealthReason,type KeyProvider,type KeyState} from '../../supabase/functions/_shared/keyHealthRules';
export interface ApiKeyHealthRow {org_id:string;provider:KeyProvider;state:KeyState;status_code:number;key_source:'org'|'global';feature:string;first_failed_at:string;last_failed_at:string;failure_count:number}
export const KEY_FEATURE_LABELS:Record<string,string>={deep_find:'Deep find',role_search:'Role search',drafting:'Drafting',scrape:'Scraping',key_test:'Key test',reply_drafting:'Reply drafting',note_parsing:'Note parsing',enrichment:'Enrichment',verification:'Email verification',lookup:'Lookup',research:'Research',sequence:'Sequence choice',csv_parsing:'CSV parsing',icp_parsing:'Customer profile parsing'};
/** Validate untrusted realtime data and hide only short-lived rate limits after fifteen minutes. */
export function visibleKeyHealth(raw:unknown,orgId:string,now=Date.now()):ApiKeyHealthRow[] {
  if(!Array.isArray(raw))return [];
  return raw.filter((row):row is ApiKeyHealthRow=>row&&row.org_id===orgId&&KEY_PROVIDERS.includes(row.provider)
    &&['refused','needs_topup','rate_limited'].includes(row.state)&&['org','global'].includes(row.key_source)
    &&typeof row.feature==='string'&&/^[a-z_]{1,40}$/.test(row.feature)
    &&Number.isFinite(Date.parse(row.first_failed_at))&&Number.isFinite(Date.parse(row.last_failed_at))
    &&(row.state!=='rate_limited'||Date.parse(row.last_failed_at)>=now-15*60_000));
}
/** A clear followed by a new failure receives a distinct dismissal/popup identity. */
export function problemKey(row:ApiKeyHealthRow):string {return `${row.org_id}:${row.provider}:${row.first_failed_at}`;}
/** Billing/refusal alerts only; rate limits remain visible on the key and menu badge. */
export function activeKeyAlerts(rows:ApiKeyHealthRow[],dismissed:ReadonlySet<string>=new Set()):ApiKeyHealthRow[] {
  return rows.filter(row=>row.state!=='rate_limited'&&!dismissed.has(problemKey(row)));
}
/** Pure notification planning never requests browser permission. */
export function keyPopupPlans(rows:ApiKeyHealthRow[],options:{admin:boolean;enabled:boolean;permission:string;seen:ReadonlySet<string>}) {
  if(!options.admin||!options.enabled||options.permission!=='granted')return [];
  const seen=new Set(options.seen);
  return activeKeyAlerts(rows).flatMap(row=>{const key=problemKey(row);if(seen.has(key))return [];seen.add(key);return [{key,title:`${KEY_PROVIDER_COPY[row.provider].name} key needs attention`,body:keyHealthReason(row.provider,row.state),href:keySectionHref(row.provider)}];});
}
