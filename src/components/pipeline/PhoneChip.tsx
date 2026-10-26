import { parsePhone, safePhoneSourceUrl, type PhoneMetadata } from '../../../supabase/functions/_shared/phoneNumbers';

const KIND = { company_line: 'Company line', direct: 'Direct line', mobile: 'Mobile', unknown: 'Unknown' };
const SOURCE = { places: 'Google Places', own_site: 'Company website', worker_scrape: 'Browser scraper', registry: 'Business registry', apollo: 'Apollo', manual: 'Manual', other: 'Other source' };

/** A business number with an honest relationship label and source details accessible by touch or keyboard. */
export function PhoneChip({ value, country, metadata }: { value: string; country?: unknown; metadata?: PhoneMetadata }) {
  const phone = parsePhone(value, country);
  const kind = KIND[metadata?.kind ?? 'unknown'] ?? 'Unknown';
  const source = SOURCE[metadata?.source ?? 'manual'] ?? 'Other source';
  const url = safePhoneSourceUrl(metadata?.source_url);
  const plan = phone?.lineType === 'landline' ? 'Landline' : phone?.lineType === 'mobile' ? 'Mobile number' : 'Number type unknown';
  const provenance = `${source}. ${plan}.${metadata?.found_at ? ` Found ${metadata.found_at}.` : ' Found date unknown.'}`;
  return <div className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-sm">
    {phone ? <a href={`tel:${phone.value}`} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
      className="min-w-0 break-all text-offwhite underline focus-visible:outline-2 focus-visible:outline-violet-line" title={provenance}>{value}</a>
      : <span className="break-all">{value}</span>}
    <span className="text-xs text-offwhite">{kind}</span>
    {metadata?.sole_trader && <span className="text-xs text-warning">Sole trader / partnership</span>}
    <details className="min-w-0 max-w-full text-xs" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <summary className="cursor-pointer text-offwhite underline focus-visible:outline-2 focus-visible:outline-violet-line" aria-label={`Phone source for ${value}`}>Source</summary>
      <span className="block break-words py-1 [overflow-wrap:anywhere]">{provenance}{metadata?.original && metadata.original !== value ? ` Original: ${metadata.original}.` : ''}
        {url && <> <a href={url} target="_blank" rel="noopener noreferrer" className="underline">Source page</a></>}
      </span>
    </details>
  </div>;
}
