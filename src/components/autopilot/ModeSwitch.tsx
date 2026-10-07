import { Button } from '../ui/Button';

export type AutopilotModeChoice = 'discover' | 'selected';

/** Toggle between finding new leads and working through selected leads. */
export function ModeSwitch({ mode, onChange }: { mode: AutopilotModeChoice; onChange: (m: AutopilotModeChoice) => void }) {
  return (
    <div role="group" aria-label="Autopilot mode" className="flex gap-2">
      <Button variant={mode === 'discover' ? 'primary' : 'secondary'} aria-pressed={mode === 'discover'} onClick={() => onChange('discover')}>Find new leads</Button>
      <Button variant={mode === 'selected' ? 'primary' : 'secondary'} aria-pressed={mode === 'selected'} onClick={() => onChange('selected')}>Selected leads</Button>
    </div>
  );
}
