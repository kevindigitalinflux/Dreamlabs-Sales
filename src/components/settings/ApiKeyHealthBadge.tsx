import {useOrg} from '../../hooks/useOrg';
import {useApiKeyHealth} from '../../hooks/useApiKeyHealth';

/** Admin-only count includes recent soft rate limits; no account detail is exposed on the menu. */
export function ApiKeyHealthBadge() {
  const {currentOrg}=useOrg();const {rows}=useApiKeyHealth(currentOrg?.role==='admin'?currentOrg.id:null);
  if(currentOrg?.role!=='admin'||!rows.length)return null;
  return <span aria-label={`${rows.length} API keys need attention`} className="rounded-full border border-warning bg-card px-2 py-0.5 text-[11px] font-bold text-warning">{rows.length}</span>;
}
