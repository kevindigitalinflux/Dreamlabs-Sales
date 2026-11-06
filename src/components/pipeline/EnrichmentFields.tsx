import {ArrowRight,Plus} from 'lucide-react';
import type {EnrichableField,EnrichmentResult} from '../../types';
const FIELD_LABELS: Record<EnrichableField, string> = {
  email: 'Email', phone: 'Phone', owner_name: 'Owner', website: 'Website',
};
const SOURCE_LABELS: Record<string, string> = {
  firecrawl: 'Firecrawl',
  website: 'website', companies_house: 'Companies House', opencorporates: 'OpenCorporates',
  hunter: 'Hunter', apollo: 'Apollo', google_places: 'Google Places',
};


export function EnrichmentFields({r,name,fromSnapshot,checked,replaceExisting,toggle,busy}:{r:EnrichmentResult;name:string;fromSnapshot:Record<string,Partial<Record<EnrichableField,string>>>;checked:Record<string,Set<EnrichableField>>;replaceExisting:boolean;toggle:(id:string,field:EnrichableField)=>void;busy:boolean}) {
 const lead={business_name:name};
 return (<ul className="flex flex-col gap-1">
                {(Object.keys(r.proposed) as EnrichableField[]).map((field) => {
                  const existing = fromSnapshot[r.lead_id]?.[field] ?? '';
                  const hasExisting = existing.trim() !== '';
                  // An existing value is kept (and the new one saved as a note) unless "replace" is on.
                  const keepsExisting = hasExisting && !replaceExisting;
                  const to = r.proposed[field]!;
                  const isChecked = checked[r.lead_id]?.has(field) ?? false;
                  return (
                    <li key={field} className="flex flex-wrap items-center gap-2 rounded bg-surface/60 p-2 text-sm">
                      <input type="checkbox" checked={isChecked} disabled={busy} onChange={() => toggle(r.lead_id, field)} className="h-4 w-4 accent-violet-500" aria-label={`Apply ${field} for ${lead?.business_name ?? r.lead_id}`} />
                      <span className="w-16 text-xs font-semibold text-muted">{FIELD_LABELS[field]}</span>
                      {keepsExisting ? (
                        <>
                          <span className="text-muted">{existing}</span>
                          <span className="text-[10px] uppercase text-muted">kept</span>
                          <Plus className="h-3.5 w-3.5 text-muted" aria-hidden />
                          <span className="text-[10px] uppercase text-muted">additional</span>
                        </>
                      ) : (
                        <>
                          <span className={hasExisting ? 'text-muted line-through' : 'text-muted'}>{hasExisting ? existing : '—'}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden />
                        </>
                      )}
                      <span className="min-w-0 break-all font-semibold text-success">{to}</span>
                      <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted">{SOURCE_LABELS[r.source[field] ?? ''] ?? r.source[field]}</span>
                    </li>
                  );
                })}
              </ul>);
}
