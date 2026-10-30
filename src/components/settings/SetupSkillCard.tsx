import instructions from '../../../setup-skill/START HERE.txt?raw';
import { Card } from '../ui/Card';
import { ImportSetupButton } from '../mdImport/ImportSetupButton';

const blocks = instructions.trim().split(/\r?\n\r?\n/);

/** Member-wide download help; the existing import control keeps its admin/session checks. */
export function SetupSkillCard({ isAdmin, onApplied }: { isAdmin: boolean; onApplied: () => void }) {
  return <Card>
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="text-[18px] font-bold">Setup skill</h2>
      <p className="text-sm text-muted">Get help writing your company details, customer profiles, packages, email templates and sequences. Review the finished files before saving them.</p>
      <div className="flex flex-wrap items-center gap-3">
        {isAdmin && <ImportSetupButton onApplied={onApplied} />}
        <a
          href="/downloads/dreamlabs-sales-setup-skill.zip"
          download="dreamlabs-sales-setup-skill.zip"
          className="inline-flex min-h-11 max-w-full items-center justify-center rounded-lg border border-line bg-surface px-4 py-2 text-[15px] font-semibold text-offwhite transition-colors hover:bg-surface/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-line motion-reduce:transition-none"
        >Download setup skill</a>
      </div>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-offwhite [overflow-wrap:anywhere]">
        {blocks.slice(0, 7).map((step, index) => <li key={index} className="whitespace-pre-line">{step.replace(/^\d+\. /, '')}</li>)}
      </ol>
      <p className="text-sm text-muted">{blocks[7]}</p>
    </div>
  </Card>;
}
