import {useEffect,useState} from 'react';
import {useOrg} from '../../hooks/useOrg';
import {useApiKeyHealth} from '../../hooks/useApiKeyHealth';
import {useKeyHealthDesktopNotifications} from '../../hooks/useKeyHealthDesktopNotifications';
import {activeKeyAlerts,problemKey} from '../../lib/keyHealthView';
import {readSeen,writeSeen} from '../../lib/jobs/seen';
import {KeyHealthBannerView} from './KeyHealthBannerView';
const storage=()=>{try{return window.sessionStorage;}catch{return null;}};

/** Session dismissal never mutates server health and resets for a new problem identity. */
export function ApiKeyHealthBanner() {
  const {currentOrg}=useOrg();const orgId=currentOrg?.id??null;const admin=currentOrg?.role==='admin';
  const {rows,loading,error}=useApiKeyHealth(orgId);const scope=`key-health-dismissed:${orgId??''}`;
  const [dismissed,setDismissed]=useState(()=>readSeen(storage(),scope));
  useEffect(()=>setDismissed(readSeen(storage(),scope)),[scope]);
  useKeyHealthDesktopNotifications(rows,loading,orgId,admin);
  return <>{error&&admin&&<p role="status" className="px-4 py-2 text-sm text-muted">{error}</p>}
    <KeyHealthBannerView rows={activeKeyAlerts(rows,dismissed)} admin={admin} onDismiss={row=>setDismissed(old=>{const next=new Set(old);next.add(problemKey(row));writeSeen(storage(),scope,next);return next;})}/></>;
}
