import { Button } from './Button';
/** Sticky controls shared by manual review lists. */
export function BulkActionBar({ count, busy, approveLabel, rejectLabel, onApprove, onReject, onClear, showEmpty=false }: {
 count:number; busy:boolean; approveLabel:string; rejectLabel?:string; showEmpty?:boolean;
 onApprove:()=>void; onReject?:()=>void; onClear:()=>void;
}) {
 if (!count&&!showEmpty) return null;
 return <div className="sticky bottom-2 z-10 flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-3 shadow-lg" aria-busy={busy}>
 <span role="status">{count} selected:</span>
 <Button disabled={busy||!count} onClick={onApprove}>{approveLabel}</Button>
 {onReject&&<Button variant="secondary" disabled={busy||!count} onClick={onReject}>{rejectLabel}</Button>}
 <Button variant="ghost" disabled={busy} onClick={onClear}>Clear</Button>
 </div>;
}
