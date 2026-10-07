import { Input, SelectField } from '../ui/Input';

export interface WindowValues {
  start: string;
  end: string;
  timeZone: string;
  dailySendCap: number;
  spendCap: string;
}

interface Props {
  value: WindowValues;
  onChange: (next: WindowValues) => void;
  /** Validation message for the window, or null when it is fine. */
  windowError: string | null;
}

const COMMON_ZONES = ['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'UTC'];

/** Sending window, timezone and caps for a selected-leads run. */
export function WindowFields({ value, onChange, windowError }: Props) {
  const set = (patch: Partial<WindowValues>) => onChange({ ...value, ...patch });
  const zones = COMMON_ZONES.includes(value.timeZone) ? COMMON_ZONES : [value.timeZone, ...COMMON_ZONES];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Start time" type="time" value={value.start} onChange={(e) => set({ start: e.target.value })} />
        <Input label="Finish time" type="time" value={value.end} onChange={(e) => set({ end: e.target.value })} />
      </div>
      {windowError && <p role="alert" className="text-sm text-danger">{windowError}</p>}
      <SelectField label="Timezone" value={value.timeZone} onChange={(e) => set({ timeZone: e.target.value })}>
        {zones.map((z) => <option key={z} value={z}>{z}</option>)}
      </SelectField>
      <Input label="Cold outreach sends per day" type="number" value={String(value.dailySendCap)} onChange={(e) => set({ dailySendCap: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} />
      <Input label="Optional total spend cap ($)" type="number" value={value.spendCap} onChange={(e) => set({ spendCap: e.target.value })} placeholder="No cap" />
    </div>
  );
}
