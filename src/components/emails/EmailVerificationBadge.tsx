import type {VerificationView} from '../../lib/emailVerification';
/** Plain status for the exact recipient; unconfirmed is a disclosure, not an automatic send block. */
export function EmailVerificationBadge({value}:{value:VerificationView}) {
  return <span role="status" className={`break-words text-xs ${value.status==='invalid'?'text-danger':value.status==='valid'?'text-success':'text-warning'}`}>{value.label}</span>;
}
