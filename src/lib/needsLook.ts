interface ReviewLead {id:string;email?:string|null;additional_emails?:string[];email_contacts?:{email?:string|null;dismissed_at?:string|null}[];readiness?:string|null;readiness_missing?:string[]|null}
export function needsLook(lead:ReviewLead,facts:{weakOnly?:boolean;companyConflict?:boolean;websiteSuspect?:boolean;bounced?:string[]}) {
 const addresses=[lead.email,...(lead.additional_emails??[]),...(lead.email_contacts??[]).filter(c=>!c.dismissed_at).map(c=>c.email)].filter((address):address is string=>!!address?.trim());
 const bounced=new Set((facts.bounced??[]).map(address=>address.toLowerCase()));
 return !!(facts.weakOnly||facts.companyConflict||facts.websiteSuspect||lead.readiness==='needs_work'
  ||lead.readiness_missing?.some(key=>['sendable_email','verified_email'].includes(key))
  ||(addresses.length&&addresses.every(address=>bounced.has(address.trim().toLowerCase()))));
}
