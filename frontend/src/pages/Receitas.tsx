import { startTransition, useMemo, useEffect, useState } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { exportRegistrosPDF, exportRegistrosXLSX } from '@/lib/exportRegistros'
import { POSITIVE, NEGATIVE } from '@/lib/pdfReport'
import { FilteredPage } from '@/components/layout/FilteredPage'
import { TimelineChart } from '@/components/charts/TimelineChart'
import { DonutChart } from '@/components/charts/DonutChart'
import { DataTable } from '@/components/tables/DataTable'
import { Badge } from '@/components/ui/badge'
import { useReceitas } from '@/hooks/useFinanceiro'
import { useFilterStore } from '@/hooks/useFilters'
import { formatCurrency, formatCompact, parseDate } from '@/lib/formatters'
import type { ReceitaRecord } from '@/types'
import { EMPRESA_COLORS, TIPO_LABEL } from '@/types'

const col = createColumnHelper<ReceitaRecord>()

const columns = [
  col.accessor('empresa', {
    header: 'Empresa',
    cell: (info) => {
      const emp = info.getValue()
      const color = EMPRESA_COLORS[emp] ?? '#6b7280'
      return (
        <span
          className="inline-flex px-2 py-0.5 text-xs font-black uppercase text-white"
          style={{ backgroundColor: color }}
        >
          {emp.slice(0, 3).toUpperCase()}
        </span>
      )
    },
  }),
  col.accessor('obra', { header: 'Obra' }),
  col.accessor('cliente', { header: 'Cliente' }),
  col.accessor('tipo', {
    header: 'Tipo',
    cell: (info) => TIPO_LABEL[info.getValue()] || info.getValue(),
  }),
  col.accessor('data', { header: 'Data' }),
  col.accessor('status', {
    header: 'Status',
    cell: (info) => {
      const v = info.getValue()
      return <Badge variant={v === 'Recebida' ? 'success' : 'warning'}>{v}</Badge>
    },
  }),
  col.accessor('valor', {
    header: 'Valor',
    cell: (info) => (
      <span className="font-black tabular-nums block text-right">{formatCurrency(info.getValue())}</span>
    ),
  }),
]

export default function Receitas() {
  useEffect(() => { document.title = 'Receitas | DashFinance' }, [])
  const { data: allData, isLoading } = useReceitas()
  const filters = useFilterStore()

  const filtered = useMemo(() => {
    if (!allData) return []
    const d1 = filters.dtInicio ? new Date(filters.dtInicio + 'T00:00:00') : null
    const d2 = filters.dtFim ? new Date(filters.dtFim + 'T23:59:59') : null
    return allData.filter((r) => {
      if (d1 || d2) {
        const rd = parseDate(r.data)
        if (!rd) return false
        if (d1 && rd < d1) return false
        if (d2 && rd > d2) return false
      }
      if (filters.empresas.length > 0 && !filters.empresas.includes(r.empresa)) return false
      if (filters.obras.length > 0 && !filters.obras.includes(r.obra)) return false
      if (filters.status_list.length > 0 && !filters.status_list.includes(r.status)) return false
      if (filters.bancos.length > 0) {
        if (r.banco && !filters.bancos.includes(r.banco)) return false
      }
      if (filters.contas.length > 0) {
        if (r.conta && !filters.contas.includes(r.conta)) return false
      }
      return true
    })
  }, [allData, filters])

  const kpis = useMemo(() => {
    const total = filtered.reduce((s, r) => s + r.valor, 0)
    const recebido = filtered.filter((r) => r.status === 'Recebida').reduce((s, r) => s + r.valor, 0)
    const aReceber = filtered.filter((r) => r.status === 'A Receber').reduce((s, r) => s + r.valor, 0)
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const emAtraso = filtered
      .filter((r) => r.status === 'A Receber' && (() => { const d = parseDate(r.data_venc); return d !== null && d < hoje })())
      .reduce((s, r) => s + r.valor, 0)
    const taxa = total > 0 ? (recebido / total) * 100 : 0
    return { total, recebido, aReceber, emAtraso, taxa }
  }, [filtered])

  const [searchTags, setSearchTags] = useState<string[]>([])
  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase()
    if (t && !searchTags.includes(t)) setSearchTags((prev) => [...prev, t])
  }
  const removeTag = (i: number) => setSearchTags((prev) => prev.filter((_, idx) => idx !== i))

  const tableData = useMemo(() => {
    if (searchTags.length === 0) return filtered
    return filtered.filter((r) => {
      const text = [r.empresa, r.obra, r.cliente, r.tipo, TIPO_LABEL[r.tipo] ?? '', r.data, r.banco, r.conta, r.status]
        .join(' ').toLowerCase()
      return searchTags.every((tag) => text.includes(tag))
    })
  }, [filtered, searchTags])

  const tableTotal = useMemo(() => tableData.reduce((s, r) => s + r.valor, 0), [tableData])

  const [chartMode, setChartMode] = useState<'daily' | 'monthly'>('daily')

  useEffect(() => {
    if (!filters.dtInicio || !filters.dtFim) return
    const days = (new Date(filters.dtFim).getTime() - new Date(filters.dtInicio).getTime()) / 86_400_000
    startTransition(() => setChartMode(days > 30 ? 'monthly' : 'daily'))
  }, [filters.dtInicio, filters.dtFim])

  const chartData = useMemo(() => {
    const byPeriod: Record<string, { recebida: number; a_receber: number }> = {}
    filtered.forEach((r) => {
      const d = parseDate(r.data)
      if (!d) return
      const key = chartMode === 'daily'
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!byPeriod[key]) byPeriod[key] = { recebida: 0, a_receber: 0 }
      if (r.status === 'Recebida') byPeriod[key].recebida += r.valor
      else byPeriod[key].a_receber += r.valor
    })
    return Object.entries(byPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => {
        if (chartMode === 'daily') {
          const [, m, dd] = key.split('-')
          return { label: `${dd}/${m}`, ...v }
        } else {
          const [y, m] = key.split('-')
          return { label: `${m}/${y}`, ...v }
        }
      })
  }, [filtered, chartMode])

  const { obrasData, clientesData, totalRecebido } = useMemo(() => {
    if (!filtered) return { obrasData: [], clientesData: [], totalRecebido: 0 }
    const byObra: Record<string, number> = {}
    const byCliente: Record<string, number> = {}
    let total = 0
    const CHART_COLORS = ['var(--chart-recebida)', 'var(--chart-receita)', 'var(--chart-a-receber)', 'var(--chart-saldo)', 'var(--chart-despesa)', 'var(--chart-previsto)', 'var(--chart-emissao)', 'var(--chart-pago)']
    const formatTopN = (arr: [string, number][], n = 5) => {
      const result = arr.slice(0, n)
      const others = arr.slice(n).reduce((acc, curr) => acc + curr[1], 0)
      if (others > 0) result.push(['Outros', others])
      return result.map(([name, value], i) => ({ name: name || 'N/A', value, color: CHART_COLORS[i % CHART_COLORS.length] }))
    }
    filtered.forEach((r) => {
      byObra[r.obra || 'N/A'] = (byObra[r.obra || 'N/A'] || 0) + r.valor
      byCliente[r.cliente || 'N/A'] = (byCliente[r.cliente || 'N/A'] || 0) + r.valor
      total += r.valor
    })
    return {
      obrasData: formatTopN(Object.entries(byObra).sort((a, b) => b[1] - a[1]), 5),
      clientesData: formatTopN(Object.entries(byCliente).sort((a, b) => b[1] - a[1]), 6),
      totalRecebido: total,
    }
  }, [filtered])

  const empresaLabel = filters.empresas.length > 0 ? filters.empresas.join(', ') : 'Todas as Empresas'
  const periodoLabel = filters.dtInicio && filters.dtFim
    ? `${filters.dtInicio.split('-').reverse().join('/')} a ${filters.dtFim.split('-').reverse().join('/')}`
    : 'Período completo'

  const handleExportXLSX = () => exportRegistrosXLSX({
    titulo: 'Receitas',
    slug: 'receitas',
    sheetName: 'Receitas',
    empresaLabel,
    periodoLabel,
    headers: ['Obra', 'Cliente', 'Tipo', 'Data', 'Data Venc.', 'Status', 'Valor'],
    linhas: filtered.map((r) => [r.obra, r.cliente, TIPO_LABEL[r.tipo] || r.tipo, r.data, r.data_venc, r.status, r.valor]),
    total: kpis.total,
    larguras: [35, 45, 20, 12, 12, 14, 18],
  })

  const handleExportPDF = () => exportRegistrosPDF({
    titulo: 'Receitas',
    slug: 'receitas',
    empresaLabel,
    periodoLabel,
    colunas: [
      { header: 'Obra', width: 18 },
      { header: 'Cliente', width: 82 },
      { header: 'Tipo', width: 24 },
      { header: 'Data Venc.', width: 22, align: 'center' },
      { header: 'Status', width: 22, align: 'center' },
      { header: 'Valor', width: 26, align: 'right' },
    ],
    linhas: filtered.map((r) => [
      r.obra, r.cliente, TIPO_LABEL[r.tipo] || r.tipo, r.data_venc, r.status,
      formatCurrency(r.valor),
    ]),
    total: kpis.total,
    kpisExtras: [
      { label: 'Recebido', value: formatCurrency(kpis.recebido), tone: POSITIVE },
      { label: 'A receber', value: formatCurrency(kpis.aReceber) },
      { label: 'Em atraso', value: formatCurrency(kpis.emAtraso), tone: NEGATIVE },
    ],
  })

  if (isLoading) {
    return (
      <FilteredPage showStatus>
        <div className="space-y-6">
          <div className="h-44 bg-white block-border animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-8 h-80 bg-white block-border animate-pulse" />
            <div className="lg:col-span-4 h-80 bg-white block-border animate-pulse" />
          </div>
          <div className="h-64 bg-white block-border animate-pulse" />
        </div>
      </FilteredPage>
    )
  }

  return (
    <FilteredPage showStatus>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">

        {/* Hero KPI */}
        <div className="data-panel lg:col-span-12 flex flex-col justify-between gap-7 p-6 md:p-7 xl:flex-row">
          <div>
            <p className="section-label text-brand">Receitas consolidadas</p>
            <p className="mt-4 text-sm font-medium text-muted-foreground">
              Total do período <span className="ml-2 font-semibold text-brand">{filtered.length} registros</span>
            </p>
            <h2 className="hero-metric mt-2 text-dark">{formatCompact(kpis.total)}</h2>
          </div>
          <div className="grid w-full grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:border-t-0 xl:max-w-xl">
            <div className="metric-cell px-0 pt-4 sm:pt-3">
              <p className="section-label">A receber</p>
              <p className="mt-2 text-2xl font-semibold text-dark">{formatCompact(kpis.aReceber)}</p>
            </div>
            <div className="metric-cell px-0 pt-4 sm:pl-5 sm:pt-3">
              <p className="section-label text-negative">Em atraso</p>
              <p className="mt-2 text-2xl font-semibold text-negative">{formatCompact(kpis.emAtraso)}</p>
            </div>
            <div className="metric-cell px-0 pt-4 sm:pl-5 sm:pt-3">
              <p className="section-label text-positive">Recebido</p>
              <p className="mt-2 text-2xl font-semibold text-positive">{formatCompact(kpis.recebido)}</p>
            </div>
          </div>
        </div>

        {/* Taxa de Recebimento */}
        <div className="data-panel lg:col-span-12 p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-black uppercase">Taxa de Recebimento</h3>
            <span className="text-2xl font-black">{kpis.taxa.toFixed(1)}%</span>
          </div>
          <div className="h-3 bg-bgBase block-border overflow-hidden">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${kpis.taxa}%` }}
            />
          </div>
          <div className="flex justify-between text-xs font-bold text-muted-foreground mt-2 uppercase">
            <span>Recebido: {formatCompact(kpis.recebido)}</span>
            <span>A Receber: {formatCompact(kpis.aReceber)}</span>
          </div>
        </div>

        {/* Chart: Timeline */}
        <div className="data-panel lg:col-span-8 flex flex-col p-6 md:p-7">
          <div className="flex justify-between items-end mb-8">
            <h3 className="text-lg font-black uppercase">
              {chartMode === 'daily' ? 'Timeline Diário' : 'Timeline Mensal'} de Recebimentos
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setChartMode('daily')}
                className={`px-3 py-1 text-xs font-black uppercase transition-colors ${
                  chartMode === 'daily'
                    ? 'bg-dark text-white'
                    : 'border-2 border-dark text-dark hover:bg-bgBase'
                }`}
              >
                Diário
              </button>
              <button
                onClick={() => setChartMode('monthly')}
                className={`px-3 py-1 text-xs font-black uppercase transition-colors ${
                  chartMode === 'monthly'
                    ? 'bg-dark text-white'
                    : 'border-2 border-dark text-dark hover:bg-bgBase'
                }`}
              >
                Mensal
              </button>
            </div>
          </div>
          <div className="flex-1">
            <TimelineChart
              data={chartData}
              bars={[
                { key: 'recebida', color: 'var(--chart-recebida)', name: 'Recebida' },
                { key: 'a_receber', color: 'var(--chart-a-receber)', name: 'A Receber' },
              ]}
              height={350}
            />
          </div>
        </div>

        {/* Charts: Right column */}
        <div className="lg:col-span-4 flex flex-col gap-5">
          <div className="data-panel flex-1 p-6">
            <h3 className="text-sm font-black uppercase mb-4">Por Obra</h3>
            <DonutChart
              data={obrasData}
              centerLabel="Total"
              centerValue={formatCompact(totalRecebido)}
              height={160}
            />
          </div>
          <div className="data-panel flex-1 p-6">
            <h3 className="text-sm font-black uppercase mb-4">Por Cliente (Top 6)</h3>
            <DonutChart
              data={clientesData}
              centerLabel="Total"
              centerValue={formatCompact(totalRecebido)}
              height={160}
            />
          </div>
        </div>

        {/* Table */}
        <div className="data-panel lg:col-span-12 p-6 md:p-7">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
            <h3 className="text-lg font-black uppercase">Detalhamento</h3>
            <div className="flex gap-3">
              <button
                onClick={handleExportXLSX}
                className="flex items-center gap-2 bg-dark text-white font-black uppercase text-xs px-4 py-2 border-2 border-dark hover:bg-brand hover:text-dark transition-colors"
              >
                <FileSpreadsheet className="h-4 w-4" />XLSX
              </button>
              <button
                onClick={handleExportPDF}
                className="flex items-center gap-2 bg-dark text-white font-black uppercase text-xs px-4 py-2 border-2 border-dark hover:bg-brand hover:text-dark transition-colors"
              >
                <FileText className="h-4 w-4" />PDF
              </button>
            </div>
          </div>
          <DataTable
            data={tableData}
            columns={columns as ColumnDef<ReceitaRecord, unknown>[]}
            searchPlaceholder="Buscar e pressione Enter para filtrar..."
            searchTags={searchTags}
            onAddTag={addTag}
            onRemoveTag={removeTag}
            footerRow={
              <tr>
                <td colSpan={6} className="px-4 py-3 text-xs font-black text-right text-gray-500 uppercase">
                  {searchTags.length > 0 ? 'Total Filtrado' : 'Total do Período'}
                </td>
                <td className="px-4 py-3 text-sm font-black text-right tabular-nums">
                  {formatCurrency(tableTotal)}
                </td>
              </tr>
            }
          />
        </div>

      </div>
    </FilteredPage>
  )
}
