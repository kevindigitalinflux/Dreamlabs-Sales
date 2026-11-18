import {KEY_PROVIDER_COPY,keyHealthReason} from '../../../supabase/functions/_shared/keyHealthRules';
import {KEY_FEATURE_LABELS,type ApiKeyHealthRow} from '../../lib/keyHealthView';

/** Shared-key users see ownership guidance; only platform owners see its billing link. */
export function KeyHealthFlag({row,platformOwner=false,summary=false}:{row:ApiKeyHealthRow;platformOwner?:boolean;summary?:boolean}) {
  const color=row.state==='refused'?'text-danger-strong':row.state==='needs_topup'?'text-warning font-semibold':'text-warning';
  if(summary)return <span className={`${row.state==='rate_limited'?'font-medium':'font-semibold'} ${color}`}>{keyHealthReason(row.provider,row.state)}</span>;
  const billing=KEY_PROVIDER_COPY[row.provider].billing;
  return <div role="status" className={`flex min-w-0 flex-col gap-1 rounded-control border border-line ${row.state==='rate_limited'?'bg-raised':'bg-card'} p-3 text-sm ${color}`}>
    <p className="font-semibold">{keyHealthReason(row.provider,row.state)}</p>
    <p>Since <time dateTime={row.first_failed_at}>{new Date(row.first_failed_at).toLocaleString('en-GB')}</time>. Feature: {KEY_FEATURE_LABELS[row.feature]??'Provider lookup'}.</p>
    {row.key_source==='global'&&<p>This account uses the platform's shared key. The platform owner must fix it.</p>}
    {billing&&(row.key_source==='org'||platformOwner)&&<a href={billing} target="_blank" rel="noreferrer" className="w-fit font-semibold text-link underline">Open provider billing or account</a>}
    <p>Test the key again or save a replacement below.</p>
  </div>;
}
