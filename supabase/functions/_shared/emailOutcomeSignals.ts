export interface EmailOutcomeRow {org_id:string;address:string;domain:string;outcome:string;seen_at:string}
export const DOMAIN_BOUNCE_WARNING='Several addresses at this domain bounced: check the format';
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
