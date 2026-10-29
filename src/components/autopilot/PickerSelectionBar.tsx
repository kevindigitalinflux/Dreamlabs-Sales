import { Button } from '../ui/Button';
interface Props {
  count: number; pipelines: number; hidden: number; matching: number; selectedOnly: boolean;
  onSelectAll: () => void; onClear: () => void; onSelectedOnly: (on: boolean) => void;
}

/** Sticky summary always counts the cross-pipeline selection, independently of filters. */
export function PickerSelectionBar({ count, pipelines, hidden, matching, selectedOnly, onSelectAll, onClear, onSelectedOnly }: Props) {
  return <div className="sticky top-0 z-20 flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-card p-3 shadow-sm">
    <p role="status" className="text-sm font-semibold">{count} selected in {pipelines} {pipelines === 1 ? 'pipeline' : 'pipelines'}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={onSelectAll} disabled={matching === 0}>Select all matching ({matching})</Button>
      <Button variant="secondary" onClick={onClear} disabled={count === 0}>Clear selection</Button>
    </div>
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" checked={selectedOnly} onChange={e => onSelectedOnly(e.target.checked)}
        className="h-4 w-4 accent-violet-500 focus-visible:outline-2 focus-visible:outline-violet-line" />Show only selected
    </label>
    {hidden > 0 && <p className="text-xs text-muted">{hidden} selected {hidden === 1 ? 'lead is' : 'leads are'} hidden by your filters</p>}
  </div>;
}
