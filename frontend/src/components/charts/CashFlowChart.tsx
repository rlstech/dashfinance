import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { formatCurrency, formatCompact } from '@/lib/formatters'

interface CashFlowChartProps {
  data: { label: string; entradas: number; saidas: number; acumulado: number }[]
  height?: number
}

export function CashFlowChart({ data, height = 350 }: CashFlowChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="label"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="left"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompact(v)}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fill: 'hsl(var(--info))', fontSize: 11 }}
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
        <Legend wrapperStyle={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }} />
        <Bar yAxisId="left" dataKey="entradas" name="Entradas" fill="hsl(var(--positive))" stackId="a" radius={[3, 3, 0, 0]} />
        <Bar yAxisId="left" dataKey="saidas" name="Saidas" fill="hsl(var(--negative))" stackId="a" radius={[3, 3, 0, 0]} />
        <Line yAxisId="right" type="monotone" dataKey="acumulado" name="Saldo Acumulado" stroke="hsl(var(--info))" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
