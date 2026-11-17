import { parsePhone } from './phoneNumbers.ts';

interface SavedLocation { country?: unknown; phone?: unknown; additional_phones?: unknown; address?: unknown; postcode?: unknown; website?: unknown }
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const US_STATES = 'AL|Alabama|AK|Alaska|AZ|Arizona|AR|Arkansas|CA|California|CO|Colorado|CT|Connecticut|DE|Delaware|DC|District of Columbia|FL|Florida|GA|Georgia|HI|Hawaii|ID|Idaho|IL|Illinois|IN|Indiana|IA|Iowa|KS|Kansas|KY|Kentucky|LA|Louisiana|ME|Maine|MD|Maryland|MA|Massachusetts|MI|Michigan|MN|Minnesota|MS|Mississippi|MO|Missouri|MT|Montana|NE|Nebraska|NV|Nevada|NH|New Hampshire|NJ|New Jersey|NM|New Mexico|NY|New York|NC|North Carolina|ND|North Dakota|OH|Ohio|OK|Oklahoma|OR|Oregon|PA|Pennsylvania|RI|Rhode Island|SC|South Carolina|SD|South Dakota|TN|Tennessee|TX|Texas|UT|Utah|VT|Vermont|VA|Virginia|WA|Washington|WV|West Virginia|WI|Wisconsin|WY|Wyoming';
const usAddress = new RegExp(`\\b(?:${US_STATES})[\\s,]+\\d{5}(?:-\\d{4})?\\b`, 'i');

/** Infer registry eligibility from saved evidence only; never assigns a country to the lead. */
export function likelyCountry(lead: SavedLocation): 'GB' | 'non_GB' | 'unknown' {
  const country = text(lead.country).toUpperCase();
  if (country) return ['GB', 'UK', 'GBR', 'UNITED KINGDOM', 'GREAT BRITAIN'].includes(country) ? 'GB' : 'non_GB';
  for (const raw of [lead.phone, ...(Array.isArray(lead.additional_phones) ? lead.additional_phones : [])]) {
    // No default country: a national-format number must not manufacture UK evidence.
    const phone = parsePhone(raw, 'OTHER');
    if (phone) return phone.value.startsWith('+44') ? 'GB' : 'non_GB';
  }
  const address = `${text(lead.address)} ${text(lead.postcode)}`;
  if (/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i.test(address)) return 'GB';
  if (usAddress.test(address)) return 'non_GB';
  const website = text(lead.website);
  if (website) try {
    const url = new URL(/^[a-z]+:\/\//i.test(website) ? website : `https://${website}`);
    if (url.hostname.replace(/\.$/, '').toLowerCase().endsWith('.uk')) return 'GB';
  } catch { /* An invalid saved website supplies no country evidence. */ }
  return 'unknown';
}
