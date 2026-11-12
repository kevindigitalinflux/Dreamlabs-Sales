/** Prefer the confirmed company site, except when it already supplied two named mailboxes. */
export function chooseScrapeDomain(input:{verified:string[];siteDomain:string|null;isDirectory(d:string):boolean;namedEmails(d:string):number}):string|null {
 const eligible=(domain:string)=>!input.isDirectory(domain)&&input.namedEmails(domain)<2;
 if(input.siteDomain&&input.verified.includes(input.siteDomain)&&eligible(input.siteDomain))return input.siteDomain;
 return input.verified.find(eligible)??null;
}
