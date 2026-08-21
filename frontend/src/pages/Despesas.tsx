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
import { useAP } from '@/hooks/useFinanceiro'
import { useFilterStore } from '@/hooks/useFilters'
import { formatCurrency, formatCompact, parseDate } from '@/lib/formatters'
import type { APRecord } from '@/types'
import { EMPRESA_COLORS, EMPRESA_ABBR } from '@/types'

const columnHelper = createColumnHelper<APRecord>()

const columns = [
  columnHelper.accessor('empresa', {
    header: 'Empresa',
    cell: (info) => {
      const emp = info.getValue()
      const color = EMPRESA_COLORS[emp] ?? '#6b7280'
      return (
        <Badge variant="outline" style={{ borderColor: color, color }}>
          {EMPRESA_ABBR[emp] ?? emp}
        </Badge>
      )
    },
  }),
  columnHelper.accessor('obra', { header: 'Obra' }),
  columnHelper.accessor('data', { header: 'Data' }),
  columnHelper.accessor('fornecedor', { header: 'Fornecedor' }),
  columnHelper.accessor('categoria', { header: 'Categoria' }),
  columnHelper.accessor('origem', {
    header: 'Origem',
    cell: (info) => {
      const origem = info.getValue()
      const variant = origem === 'Emissao' ? 'default' : origem === 'Pago' ? 'success' : 'warning'
      return <Badge variant={variant}>{origem}</Badge>
    },
  }),
  columnHelper.accessor('valor', {
    header: 'Valor',
    cell: (info) => (
      <span className="text-right block font-black tabular-nums">
        {formatCurrency(info.getValue())}
      </span>
    ),
  }),
]

export default function Despesas() {
  useEffect(() => { document.title = 'Despesas | DashFinance' }, [])
  const { data: ALL_DATA, isLoading } = useAP()
  const { empresas, obras, dtInicio, dtFim, origens, bancos, contas } = useFilterStore()

  const filteredData = useMemo(() => {
    if (!ALL_DATA) return []
    const inicio = dtInicio ? new Date(dtInicio + 'T00:00:00') : null
    const fim = dtFim ? new Date(dtFim + 'T23:59:59') : null
    return ALL_DATA.filter((r) => {
      if (empresas.length > 0 && !empresas.includes(r.empresa)) return false
      if (obras.length > 0 && !obras.includes(r.obra)) return false
      if (origens.length > 0 && !origens.includes(r.origem)) return false
      if (bancos.length > 0 && !bancos.includes(r.banco)) return false
      if (contas.length > 0 && !contas.includes(r.conta)) return false
      if (inicio || fim) {
        const d = parseDate(r.data)
        if (!d) return false
        if (inicio && d < inicio) return false
        if (fim && d > fim) return false
      }
      return true
    })
  }, [ALL_DATA, empresas, obras, dtInicio, dtFim, origens, bancos, contas])

  const kpis = useMemo(() => {
    const total = filteredData.reduce((s, r) => s + r.valor, 0)
    const emissao = filteredData.filter((r) => r.origem === 'Emissao').reduce((s, r) => s + r.valor, 0)
    const aConfirmar = filteredData.filter((r) => r.origem === 'A Confirmar').reduce((s, r) => s + r.valor, 0)
    const pago = filteredData.filter((r) => r.origem === 'Pago').reduce((s, r) => s + r.valor, 0)
    return { total, emissao, aConfirmar, pago }
  }, [filteredData])

  const [searchTags, setSearchTags] = useState<string[]>([])
  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase()
    if (t && !searchTags.includes(t)) setSearchTags((prev) => [...prev, t])
  }
  const removeTag = (i: number) => setSearchTags((prev) => prev.filter((_, idx) => idx !== i))

  const tableData = useMemo(() => {
    if (searchTags.length === 0) return filteredData
    return filteredData.filter((r) => {
      const text = [r.empresa, r.obra, r.data, r.fornecedor, r.banco, r.conta, r.categoria, r.origem]
        .join(' ').toLowerCase()
      return searchTags.every((tag) => text.includes(tag))
    })
  }, [filteredData, searchTags])

  const tableTotal = useMemo(() => tableData.reduce((s, r) => s + r.valor, 0), [tableData])

  const [chartMode, setChartMode] = useState<'daily' | 'monthly'>('daily')

  useEffect(() => {
    if (!dtInicio || !dtFim) return
    const days = (new Date(dtFim).getTime() - new Date(dtInicio).getTime()) / 86_400_000
    startTransition(() => setChartMode(days > 30 ? 'monthly' : 'daily'))
  }, [dtInicio, dtFim])

  const timelineData = useMemo(() => {
    const map = new Map<string, { emissao: number; a_confirmar: number; pago: number }>()
    filteredData.forEach((r) => {
      const d = parseDate(r.data)
      if (!d) return
      const key = chartMode === 'daily'
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const entry = map.get(key) ?? { emissao: 0, a_confirmar: 0, pago: 0 }
      if (r.origem === 'Emissao') entry.emissao += r.valor
      else if (r.origem === 'A Confirmar') entry.a_confirmar += r.valor
      else if (r.origem === 'Pago') entry.pago += r.valor
      map.set(key, entry)
    })
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => {
        if (chartMode === 'daily') {
          const [, m, dd] = key.split('-')
          return { label: `${dd}/${m}`, emissao: val.emissao, a_confirmar: val.a_confirmar, pago: val.pago }
        } else {
          const [y, m] = key.split('-')
          return { label: `${m}/${y}`, emissao: val.emissao, a_confirmar: val.a_confirmar, pago: val.pago }
        }
      })
  }, [filteredData, chartMode])

  const { categoriasData, fornecedoresData, totalValor } = useMemo(() => {
    if (!filteredData) return { categoriasData: [], fornecedoresData: [], totalValor: 0 }
    const byCat: Record<string, number> = {}
    const byFornecedor: Record<string, number> = {}
    let total = 0
    const CHART_COLORS = ['#2ea043', '#1f6feb', '#d29922', '#8957e5', '#f85149', '#373e47', '#005cc5', '#e36209']
    const formatTopN = (arr: [string, number][], n = 6) => {
      const result = arr.slice(0, n)
      const others = arr.slice(n).reduce((acc, curr) => acc + curr[1], 0)
      if (others > 0) result.push(['Outros', others])
      return result.map(([name, value], i) => ({ name: name || 'N/A', value, color: CHART_COLORS[i % CHART_COLORS.length] }))
    }
    filteredData.forEach((r) => {
      byCat[r.categoria || 'N/A'] = (byCat[r.categoria || 'N/A'] || 0) + r.valor
      byFornecedor[r.fornecedor || 'N/A'] = (byFornecedor[r.fornecedor || 'N/A'] || 0) + r.valor
      total += r.valor
    })
    return {
      categoriasData: formatTopN(Object.entries(byCat).sort((a, b) => b[1] - a[1]), 5),
      fornecedoresData: formatTopN(Object.entries(byFornecedor).sort((a, b) => b[1] - a[1]), 6),
      totalValor: total,
    }
  }, [filteredData])

  const empresaLabel = empresas.length > 0 ? empresas.join(', ') : 'Todas as Empresas'
  const periodoLabel = dtInicio && dtFim
    ? `${dtInicio.split('-').reverse().join('/')} a ${dtFim.split('-').reverse().join('/')}`
    : 'Período completo'

  const handleExportXLSX = () => exportRegistrosXLSX({
    titulo: 'Despesas',
    slug: 'despesas',
    sheetName: 'Despesas',
    empresaLabel,
    periodoLabel,
    headers: ['Obra', 'Data', 'Fornecedor', 'Banco', 'Conta', 'Categoria', 'Origem', 'Valor'],
    linhas: filteredData.map((r) => [r.obra, r.data, r.fornecedor, r.banco, r.conta, r.categoria, r.origem, r.valor]),
    total: kpis.total,
    larguras: [35, 12, 40, 20, 18, 20, 14, 18],
  })

  const handleExportPDF = () => exportRegistrosPDF({
    titulo: 'Despesas',
    slug: 'despesas',
    empresaLabel,
    periodoLabel,
    colunas: [
      { header: 'Obra', width: 30 },
      { header: 'Data', width: 16, align: 'center' },
      { header: 'Fornecedor', width: 48 },
      { header: 'Banco', width: 22 },
      { header: 'Conta', width: 18 },
      { header: 'Categoria', width: 22 },
      { header: 'Origem', width: 16, align: 'center' },
      { header: 'Valor', width: 22, align: 'right' },
    ],
    linhas: filteredData.map((r) => [
      r.obra, r.data, r.fornecedor, r.banco, r.conta, r.categoria, r.origem,
      formatCurrency(r.valor),
    ]),
    total: kpis.total,
    kpisExtras: [
      { label: 'Pago', value: formatCurrency(kpis.pago), tone: POSITIVE },
      { label: 'Em emissão', value: formatCurrency(kpis.emissao) },
      { label: 'A confirmar', value: formatCurrency(kpis.aConfirmar), tone: NEGATIVE },
    ],
  })

  if (isLoading) {
    return (
      <FilteredPage showOrigem>
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
    <FilteredPage showOrigem>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">

        {/* Hero KPI */}
        <div className="data-panel lg:col-span-12 flex flex-col justify-between gap-7 p-6 md:p-7 xl:flex-row">
          <div>
            <p className="section-label text-brand">Despesas consolidadas</p>
            <p className="mt-4 text-sm font-medium text-muted-foreground">
              Total do período <span className="ml-2 font-semibold text-brand">{filteredData.length} registros</span>
            </p>
            <h2 className="hero-metric mt-2 text-dark">{formatCompact(kpis.total)}</h2>
          </div>
          <div className="grid w-full grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:border-t-0 xl:max-w-xl">
            <div className="metric-cell px-0 pt-4 sm:pt-3">
              <p className="section-label">Emissão</p>
              <p className="mt-2 text-2xl font-semibold text-dark">{formatCompact(kpis.emissao)}</p>
            </div>
            <div className="metric-cell px-0 pt-4 sm:pl-5 sm:pt-3">
              <p className="section-label text-brand">A confirmar</p>
              <p className="mt-2 text-2xl font-semibold text-brand">{formatCompact(kpis.aConfirmar)}</p>
            </div>
            <div className="metric-cell px-0 pt-4 sm:pl-5 sm:pt-3">
              <p className="section-label text-positive">Pago</p>
              <p className="mt-2 text-2xl font-semibold text-positive">{formatCompact(kpis.pago)}</p>
            </div>
          </div>
        </div>

        {/* Chart: Timeline */}
        <div className="data-panel lg:col-span-8 flex flex-col p-6 md:p-7">
          <div className="flex justify-between items-end mb-8">
            <h3 className="text-lg font-black uppercase">
              Evolução {chartMode === 'daily' ? 'Diária' : 'Mensal'}
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
              data={timelineData}
              bars={[
                { key: 'emissao', color: '#CBD5E1', name: 'Emissão' },
                { key: 'a_confirmar', color: '#0F172A', name: 'A Confirmar' },
                { key: 'pago', color: '#22c55e', name: 'Pago' },
              ]}
              height={350}
            />
          </div>
        </div>

        {/* Charts: Right column */}
        <div className="lg:col-span-4 flex flex-col gap-5">
          <div className="data-panel flex-1 p-6">
            <h3 className="text-sm font-black uppercase mb-4">Por Categoria</h3>
            <DonutChart
              data={categoriasData}
              centerLabel="Total"
              centerValue={formatCompact(totalValor)}
              height={160}
            />
          </div>
          <div className="data-panel flex-1 p-6">
            <h3 className="text-sm font-black uppercase mb-4">Top Fornecedores</h3>
            <DonutChart
              data={fornecedoresData}
              centerLabel="Total"
              centerValue={formatCompact(totalValor)}
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
            columns={columns as ColumnDef<APRecord, unknown>[]}
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
