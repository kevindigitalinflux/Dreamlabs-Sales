/** "Step X of N" indicator with a progress bar — required on every multi-step flow. */
export function StepProgress({ step, total }: { step: number; total: number }) {
  const widthClass = ['w-1/6', 'w-2/6', 'w-3/6', 'w-4/6', 'w-5/6', 'w-full'];
  const fraction = Math.min(5, Math.max(0, Math.round((step / total) * 6) - 1));
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-muted">Step {step} of {total}</p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div className={`h-full rounded-full bg-cyan transition-all motion-reduce:transition-none ${widthClass[fraction]}`} />
      </div>
    </div>
  );
}
