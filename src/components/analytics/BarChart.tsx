import { Bar, BarChart as RechartsBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ChartDatum {
  label: string;
  value: number;
}

/** Single-series bar chart matching this app's dark palette (SPEC.md §11 tokens, hardcoded since recharts needs real hex/rgba, not Tailwind classes). */
export function BarChart({ data, color = '#00DFDF' }: { data: ChartDatum[]; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RechartsBarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: 'rgba(244,244,248,0.55)', fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: 'rgba(244,244,248,0.55)', fontSize: 12 }} axisLine={false} tickLine={false} width={32} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          contentStyle={{ background: '#111C6A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#F4F4F8' }}
        />
        <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
