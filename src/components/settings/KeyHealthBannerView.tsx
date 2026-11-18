import {Link} from 'react-router';
import {KEY_PROVIDER_COPY,keyHealthReason,keySectionHref} from '../../../supabase/functions/_shared/keyHealthRules';
import {problemKey,type ApiKeyHealthRow} from '../../lib/keyHealthView';

/** One responsive line per affected provider, without exposing account details to members. */
export function KeyHealthBannerView({rows,admin,onDismiss}:{rows:ApiKeyHealthRow[];admin:boolean;onDismiss:(row:ApiKeyHealthRow)=>void}) {
  if(!rows.length)return null;
  return <section aria-label="API key alerts" className="flex min-w-0 flex-col gap-2 border-b border-line bg-card px-4 py-2 text-sm text-offwhite">
    {rows.map(row=><div key={problemKey(row)} className="flex min-w-0 items-start gap-2">
      <p role="alert" className="min-w-0 flex-1 break-words py-2">{admin?<><span className={row.state==='refused'?'font-semibold text-danger-strong':'font-semibold text-warning'}>{KEY_PROVIDER_COPY[row.provider].name} key needs attention:</span> {keyHealthReason(row.provider,row.state)}{' '}
        <Link to={keySectionHref(row.provider)} className="font-semibold text-link underline">Fix this key</Link></>
        :`Some ${KEY_PROVIDER_COPY[row.provider].name} features are paused. Ask an admin to check the key.`}</p>
      <button type="button" onClick={()=>onDismiss(row)} aria-label={`Dismiss ${KEY_PROVIDER_COPY[row.provider].name} key alert`} className="min-h-11 min-w-11 shrink-0 rounded-control font-semibold text-muted hover:bg-raised focus-visible:outline-2 focus-visible:outline-focus">×</button>
    </div>)}
  </section>;
}
