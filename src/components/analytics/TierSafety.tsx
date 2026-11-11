import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';
import {useOrg} from '../../hooks/useOrg';
import {T2_PAUSED,type tierMetrics} from '../../../supabase/functions/_shared/tierMetrics';
type Metrics=ReturnType<typeof tierMetrics>;
/** Aggregated organisation safety counts; no recipient addresses leave the service endpoint. */
export function TierSafety(){
 const {currentOrg}=useOrg();const [data,setData]=useState<Metrics|null>(null),[error,setError]=useState<string|null>(null);
 useEffect(()=>{let cancelled=false;setData(null);setError(null);if(!currentOrg)return;
  void supabase.functions.invoke('email-settings',{body:{action:'tier_metrics',org_id:currentOrg.id}}).then(({data,error})=>{
   if(cancelled)return;if(error||data?.error)setError('Could not load tier safety rates. Refresh to retry.');else setData(data as Metrics);
  }).catch(error=>{console.error('Tier rates unavailable',error);if(!cancelled)setError('Could not load tier safety rates. Refresh to retry.');});return()=>{cancelled=true;};
 },[currentOrg?.id]);
 return <section className="rounded-xl border border-line bg-surface p-4" aria-label="Recipient tier safety">
  <h2 className="font-bold">Recipient safety: last 30 days</h2>
  <p className="text-sm text-muted">Organisation totals, using the tier recorded when each email was sent. Recent sends can still bounce later.</p>
  {error&&<p role="alert" className="text-danger">{error}</p>}
  {!data&&!error&&<p className="text-sm text-muted">Loading safety rates…</p>}
  {data&&<><p className="text-sm text-muted">{data.unclassified} historical sends have no tier and are excluded. Sent OK is a subset of T1.</p>
   {!data.t2Allowed&&<p role="alert" className="text-danger">{T2_PAUSED}</p>}
   <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Tier</th><th>Sends</th><th>Hard bounces</th><th>Rate</th></tr></thead>
    <tbody>{Object.entries(data.groups).map(([key,value])=><tr key={key}><th>{key==='sent_ok'?'Sent OK':key}</th><td>{value.sends}</td><td>{value.bounces}</td><td>{value.sends?`${(value.rate*100).toFixed(1)}%`:'Not enough data'}</td></tr>)}</tbody></table></div>
  </>}
 </section>;
}
