import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { ChartDatum } from './BarChart';

const DEFAULT_COLORS = ['#8B32FF', '#00DFDF', '#F0386B', '#64378B', '#F59E0B', '#22C55E', '#EF4444', '#94A3B8'];

/** Donut chart matching this app's dark palette. Falls back through DEFAULT_COLORS if data has more series than colors provided. */
export function DonutChart({ data, colors = DEFAULT_COLORS }: { data: ChartDatum[]; colors?: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ background: '#111C6A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#F4F4F8' }} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(244,244,248,0.55)' }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
