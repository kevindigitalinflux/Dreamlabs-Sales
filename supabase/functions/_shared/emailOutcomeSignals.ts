export interface EmailOutcomeRow {org_id:string;address:string;domain:string;outcome:string;seen_at:string}
export const DOMAIN_BOUNCE_WARNING='Several addresses at this domain bounced: check the format';
interface DomainWarningReader {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
/** Read only aggregate warnings, including hidden source leads without disclosing their addresses. */
export async function loadDomainBounceWarnings(reader:DomainWarningReader,orgId:string,domains:string[]):Promise<string[]> {
  if(!orgId)return [];
  const requested=[...new Set(domains.map(d=>d.toLowerCase()).filter(d=>/^[a-z0-9.-]{1,253}$/.test(d)))];
  const warnings=new Set<string>();
  for(let i=0;i<requested.length;i+=20) {
    const batch=requested.slice(i,i+20);
    const {data,error}=await reader.rpc('email_domain_bounce_warnings',{p_org_id:orgId,p_domains:batch});
    if(error||!Array.isArray(data))throw new Error('Domain bounce history unavailable');
    for(const row of data) {
      if(!row||typeof row!=='object'||!('domain' in row)||typeof row.domain!=='string'||!batch.includes(row.domain))throw new Error('Domain bounce history unavailable');
      warnings.add(row.domain);
    }
  }
  return [...warnings];
}
/** Distinct hard failures in this org's last fourteen days; derived data is never persisted. */
export function domainBounceWarnings(orgId:string,rows:EmailOutcomeRow[],now=new Date()):Set<string> {
  const addresses=new Map<string,Set<string>>();
  for(const row of rows) {
    const at=Date.parse(row.seen_at);
    if(row.org_id!==orgId||row.outcome!=='bounced_hard'||!Number.isFinite(at)||at<now.getTime()-14*86400000||at>now.getTime())continue;
    const domain=row.domain.toLowerCase();const seen=addresses.get(domain)??new Set<string>();
    seen.add(row.address.trim().toLowerCase());addresses.set(domain,seen);
  }
  return new Set([...addresses].filter(([,seen])=>seen.size>=3).map(([domain])=>domain));
}
