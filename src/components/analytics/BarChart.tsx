import { Bar, BarChart as RechartsBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from '../../hooks/useTheme';
import { chartNeutralsFor } from './chartColors';

export interface ChartDatum {
  label: string;
  value: number;
}

/** Single-series bar chart. Accent colors match in both themes; neutrals (gridlines/ticks/tooltip) switch via chartNeutralsFor. */
export function BarChart({ data, color = '#00DFDF' }: { data: ChartDatum[]; color?: string }) {
  const { theme } = useTheme();
  const n = chartNeutralsFor(theme);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RechartsBarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={n.grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: n.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: n.tick, fontSize: 12 }} axisLine={false} tickLine={false} width={32} />
        <Tooltip
          cursor={{ fill: n.cursor }}
          contentStyle={{ background: n.tooltipBg, border: `1px solid ${n.tooltipBorder}`, borderRadius: 8, color: n.tooltipText }}
        />
        <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
