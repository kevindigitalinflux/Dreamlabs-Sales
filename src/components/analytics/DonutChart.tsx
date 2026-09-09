import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useTheme } from '../../hooks/useTheme';
import { chartNeutralsFor } from './chartColors';
import type { ChartDatum } from './BarChart';

const DEFAULT_COLORS = ['#8B32FF', '#00DFDF', '#F0386B', '#64378B', '#F59E0B', '#22C55E', '#EF4444', '#94A3B8'];

/** Donut chart. Accent colors match in both themes; neutrals (tooltip/legend text) switch via chartNeutralsFor. */
export function DonutChart({ data, colors = DEFAULT_COLORS }: { data: ChartDatum[]; colors?: string[] }) {
  const { theme } = useTheme();
  const n = chartNeutralsFor(theme);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ background: n.tooltipBg, border: `1px solid ${n.tooltipBorder}`, borderRadius: 8, color: n.tooltipText }} />
        <Legend wrapperStyle={{ fontSize: 12, color: n.tick }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
