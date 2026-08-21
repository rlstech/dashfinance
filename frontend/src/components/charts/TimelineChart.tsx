import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { formatCurrency, formatCompact } from '@/lib/formatters'

interface TimelineChartProps {
  data: { label: string; [key: string]: number | string }[]
  bars: { key: string; color: string; name: string }[]
  height?: number
}

export function TimelineChart({ data, bars, height = 300 }: TimelineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="label"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompact(v)}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
            fontSize: 12,
            color: 'hsl(var(--popover-foreground))',
          }}
          formatter={(value: number) => [formatCurrency(value)]}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}
        />
        {bars.map((bar) => (
          <Bar
            key={bar.key}
            dataKey={bar.key}
            name={bar.name}
            fill={bar.color}
            stackId="a"
            radius={[3, 3, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
