import instructions from '../../../setup-skill/instructions.json';
import { Card } from '../ui/Card';
import { ImportSetupButton } from '../mdImport/ImportSetupButton';

const highlightedWords = [...instructions.menuWords, ...instructions.fileNames].sort((a, b) => b.length - a.length);
const highlightPattern = new RegExp(`(${highlightedWords.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');

/** Emphasises file names and menu labels without embedding markup in the shared text. */
function InstructionText({ text }: { text: string }) {
  return text.split(highlightPattern).map((part, index) => instructions.fileNames.includes(part)
    ? <code key={index} className="rounded bg-surface px-1 [overflow-wrap:anywhere]">{part}</code>
    : instructions.menuWords.includes(part) ? <strong key={index}>{part}</strong> : part);
}

/** Member-wide download help; the existing import control keeps its admin/session checks. */
export function SetupSkillCard({ isAdmin, onApplied }: { isAdmin: boolean; onApplied: () => void }) {
  return <Card>
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="text-[18px] font-bold">Setup skill</h2>
      <p className="text-sm text-offwhite">{instructions.summary}</p>
      <div className="flex flex-wrap items-center gap-3 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-violet-line">
        <a
          href="/downloads/dreamlabs-sales-setup-skill.zip"
          download="dreamlabs-sales-setup-skill.zip"
          className="inline-flex min-h-11 max-w-full items-center justify-center rounded-lg bg-violet px-4 py-2 text-[15px] font-semibold text-on-accent transition-colors hover:bg-violet/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-line motion-reduce:transition-none"
        >Download setup skill</a>
        {isAdmin && <ImportSetupButton onApplied={onApplied} />}
      </div>
      <ol aria-label="Setup steps" className="list-decimal space-y-6 pl-5 text-sm text-offwhite [overflow-wrap:anywhere]">
        {instructions.steps.map(step => <li key={step.title} className="pl-1 marker:font-bold">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <strong>{step.title}</strong>
            {step.badge && <span className="rounded border border-line bg-surface px-2 py-0.5 text-xs font-semibold">{step.badge}</span>}
          </div>
          {step.paragraphs.map(text => <p key={text}><InstructionText text={text} /></p>)}
          {step.note && <p className="mt-2">{step.note}</p>}
          {step.options && <div className="mt-3 space-y-3">
            {step.options.map(option => <details key={option.name} open={option.recommended || undefined} className="min-w-0 rounded-lg border border-line bg-surface">
              <summary className="min-h-11 cursor-pointer rounded-lg px-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-line">
                <strong>{option.name}</strong>{' '}
                <span className="whitespace-nowrap">({option.folder})</span>{' '}
                {option.recommended && <span className="inline-block rounded border border-violet-line px-2 py-0.5 text-xs font-semibold">Recommended</span>}
              </summary>
              <ol className="list-decimal space-y-3 px-4 pb-4 pl-9">
                {option.steps.map(text => <li key={text}><InstructionText text={text} /></li>)}
              </ol>
            </details>)}
          </div>}
        </li>)}
      </ol>
      <aside aria-label={instructions.troubleshooting.title} className="rounded-lg border border-line bg-surface p-4 text-sm text-offwhite">
        <strong>{instructions.troubleshooting.title}</strong>
        {instructions.troubleshooting.tips.map(text => <p key={text} className="mt-2"><InstructionText text={text} /></p>)}
      </aside>
    </div>
  </Card>;
}
