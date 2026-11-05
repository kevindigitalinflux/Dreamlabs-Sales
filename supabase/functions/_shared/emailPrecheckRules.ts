import {validEmail} from './contacts.ts';
const TYPOS:Record<string,string>={'gmial.com':'gmail.com','gamil.com':'gmail.com','gmail.con':'gmail.com','gmail.co':'gmail.com','hotmial.com':'hotmail.com','outlok.com':'outlook.com','outllook.com':'outlook.com','yaho.com':'yahoo.com','yahoo.con':'yahoo.com'};
/** Project-supported ASCII mailbox syntax, with DNS-label and dot-atom bounds. */
export function emailSyntaxValid(address:string):boolean {
  const email=validEmail(address);if(!email||email.length>254)return false;
  const [local,domain]=email.split('@');
  return !!local&&local.length<=64&&!/^\.|\.$|\.\./.test(local)&&!!domain
    &&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);
}
/** Suggestions only: never replace or correct the recipient supplied by the rep. */
export function emailDomainTypo(address:string):string|null {return TYPOS[address.trim().toLowerCase().split('@')[1]??'']??null;}
