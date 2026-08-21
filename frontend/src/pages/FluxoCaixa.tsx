import { startTransition, useMemo, useEffect, useState } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { FileText, Sheet } from 'lucide-react'
import { exportPivotPDF, exportPivotXLSX, exportExtratoPDF, exportExtratoXLSX, type ExtratoRowExport } from '@/lib/exportPivot'
import { FilterSidebar } from '@/components/filters/FilterSidebar'
import { CashFlowChart } from '@/components/charts/CashFlowChart'
import { DonutChart } from '@/components/charts/DonutChart'
import { DataTable } from '@/components/tables/DataTable'
import { useAP, useReceitas, useSaldoBanco, useSaldoConfig } from '@/hooks/useFinanceiro'
import { useFilterStore } from '@/hooks/useFilters'
import { formatCurrency, formatCompact, parseDate, compareDates } from '@/lib/formatters'
interface ExtratoRow {
  id: string
  data: string
  tipo: 'Saldo Inicial' | 'Entrada' | 'Saída'
  descricao: string
  obra: string
  empresa: string
  entrada: number | null
  saida: number | null
  saldo: number
  origem: string
  banco: string
  conta: string
}

const extratoCol = createColumnHelper<ExtratoRow>()

const extratoCols = [
  extratoCol.accessor('data', {
    header: 'Data',
    cell: (info) => {
      const v = info.getValue()
      return info.row.original.tipo === 'Saldo Inicial'
        ? <span className="font-black">{v}</span>
        : v
    },
  }),
  extratoCol.accessor('tipo', {
    header: 'Tipo',
    cell: (info) => {
      const v = info.getValue()
      const cls = v === 'Entrada' ? 'text-emerald-700' : v === 'Saída' ? 'text-red-700' : 'text-muted-foreground'
      return <span className={`${cls} font-black text-xs uppercase`}>{v}</span>
    },
  }),
  extratoCol.accessor('descricao', {
    header: 'Descrição',
    cell: (info) => {
      const v = info.getValue()
      return info.row.original.tipo === 'Saldo Inicial'
        ? <span className="font-black">{v}</span>
        : v
    },
  }),
  extratoCol.accessor('obra', { header: 'Obra' }),
  extratoCol.accessor('empresa', { header: 'Empresa' }),
  extratoCol.accessor('entrada', {
    header: 'Entrada',
    cell: (info) => {
      const v = info.getValue()
      return v !== null
        ? <span className="font-black tabular-nums block text-right text-emerald-700">{formatCurrency(v)}</span>
        : <span className="text-muted-foreground/40">—</span>
    },
  }),
  extratoCol.accessor('saida', {
    header: 'Saída',
    cell: (info) => {
      const v = info.getValue()
      return v !== null
        ? <span className="font-black tabular-nums block text-right text-red-700">{formatCurrency(v)}</span>
        : <span className="text-muted-foreground/40">—</span>
    },
  }),
  extratoCol.accessor('saldo', {
    header: 'Saldo',
    cell: (info) => {
      const v = info.getValue()
      const isInitial = info.row.original.tipo === 'Saldo Inicial'
      const cls = v >= 0 ? 'text-emerald-700' : 'text-red-700'
      return <span className={`font-black tabular-nums block text-right ${isInitial ? 'font-black' : ''} ${cls}`}>{formatCurrency(v)}</span>
    },
  }),
]

export default function FluxoCaixa() {
  useEffect(() => { document.title = 'Fluxo de Caixa | DashFinance' }, [])
  const { data: apData, isLoading: apLoading } = useAP()
  const { data: recData, isLoading: recLoading } = useReceitas()
  const { data: saldoData, isLoading: saldoLoading } = useSaldoBanco()
  const filters = useFilterStore()
  const { data: saldoConfigs } = useSaldoConfig()
  const isLoading = apLoading || recLoading || saldoLoading

  const diasData = useMemo(() => {
    if (!apData || !recData || !saldoData) return []
    const d1 = filters.dtInicio ? new Date(filters.dtInicio + 'T00:00:00') : null
    const d2 = filters.dtFim ? new Date(filters.dtFim + 'T23:59:59') : null
    const emps = filters.empresas
    const obs = filters.obras
    const visList = filters.vis
    const hasRealizado = visList.includes('realizado') || visList.includes('todos') || visList.length === 0
    const hasProjetado = visList.includes('projetado') || visList.includes('todos') || visList.length === 0

    const saidas = apData.filter((r) => {
      if (d1 || d2) { const rd = parseDate(r.data); if (!rd) return false; if (d1 && rd < d1) return false; if (d2 && rd > d2) return false }
      if (emps.length > 0 && !emps.includes(r.empresa)) return false
      if (obs.length > 0 && !obs.includes(r.obra)) return false
      if (filters.bancos.length > 0 && !filters.bancos.includes(r.banco)) return false
      if (filters.contas.length > 0 && !filters.contas.includes(r.conta)) return false
      const isRealizado = r.origem === 'Pago'
      if (isRealizado && !hasRealizado) return false
      if (!isRealizado && !hasProjetado) return false
      return true
    })

    const entradas = recData.filter((r) => {
      if (d1 || d2) { const rd = parseDate(r.data); if (!rd) return false; if (d1 && rd < d1) return false; if (d2 && rd > d2) return false }
      if (emps.length > 0 && !emps.includes(r.empresa)) return false
      if (obs.length > 0 && !obs.includes(r.obra)) return false
      if (filters.bancos.length > 0 && r.banco && !filters.bancos.includes(r.banco)) return false
      if (filters.contas.length > 0 && r.conta && !filters.contas.includes(r.conta)) return false
      const isRealizado = r.status === 'Recebida'
      if (isRealizado && !hasRealizado) return false
      if (!isRealizado && !hasProjetado) return false
      return true
    })

    const byDate: Record<string, { e: number; s: number }> = {}
    entradas.forEach((r) => { if (!byDate[r.data]) byDate[r.data] = { e: 0, s: 0 }; byDate[r.data].e += r.valor })
    saidas.forEach((r) => { if (!byDate[r.data]) byDate[r.data] = { e: 0, s: 0 }; byDate[r.data].s += r.valor })
    const sortedDates = Object.keys(byDate).sort(compareDates)

    const SYNTHETIC_DATE = '01/01/1900'
    // Empresas que têm alguma conta com saldo manual ativo
    const manualEnabledEmpresas = new Set(
      (saldoConfigs ?? []).filter((c) => c.enabled).map((c) => c.empresa)
    )
    const saldoEfetivo = [
      ...saldoData.filter((r) => {
        if (emps.length > 0 && !emps.includes(r.empresa)) return false
        if (filters.bancos.length > 0 && !filters.bancos.includes(r.banco)) return false
        if (filters.contas.length > 0 && !filters.contas.includes(r.conta)) return false
        if (manualEnabledEmpresas.has(r.empresa)) return false
        return true
      }),
      ...(saldoConfigs ?? []).flatMap((cfg) => {
        if (!cfg.enabled) return []
        if (emps.length > 0 && !emps.includes(cfg.empresa)) return []
        if (filters.bancos.length > 0 && !filters.bancos.includes(cfg.banco)) return []
        if (filters.contas.length > 0 && !filters.contas.includes(cfg.conta)) return []
        return [{ empresa: cfg.empresa, banco: cfg.banco, conta: cfg.conta, data: SYNTHETIC_DATE, saldo: cfg.saldo }]
      }),
    ]

    const timelines: Record<string, { dateObj: Date; saldo: number }[]> = {}
    saldoEfetivo.forEach((r) => {
      const key = `${r.empresa}|${r.banco}|${r.conta}`
      if (!timelines[key]) timelines[key] = []
      const d = parseDate(r.data)
      if (d) timelines[key].push({ dateObj: d, saldo: r.saldo })
    })
    Object.values(timelines).forEach((arr) => arr.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime()))

    const keys = Object.keys(timelines)
    const pointers: Record<string, number> = {}
    const current: Record<string, number | null> = {}
    keys.forEach((k) => { pointers[k] = 0; current[k] = null })

    function computeSaldoBanco(targetDate: Date): number | null {
      keys.forEach((k) => {
        const tl = timelines[k]
        while (pointers[k] < tl.length && tl[pointers[k]].dateObj <= targetDate) {
          current[k] = tl[pointers[k]].saldo
          pointers[k]++
        }
      })
      let total = 0
      let hasAny = false
      keys.forEach((k) => { if (current[k] !== null) { total += current[k]!; hasAny = true } })
      return hasAny ? total : null
    }

    let saldoPrimeiroDia: number | null = null
    if (sortedDates.length > 0) {
      const firstDate = parseDate(sortedDates[0])
      if (firstDate) {
        const dayBefore = new Date(firstDate)
        dayBefore.setDate(dayBefore.getDate() - 1)
        let total = 0
        let hasAny = false
        keys.forEach((k) => {
          const tl = timelines[k]
          for (let i = tl.length - 1; i >= 0; i--) {
            if (tl[i].dateObj <= dayBefore) { total += tl[i].saldo; hasAny = true; break }
          }
        })
        saldoPrimeiroDia = hasAny ? total : null
      }
    }

    let acumulado = saldoPrimeiroDia ?? 0
    let dias = sortedDates.map((data) => {
      const saldo_dia = byDate[data].e - byDate[data].s
      acumulado += saldo_dia
      return { data, entradas: byDate[data].e, saidas: byDate[data].s, saldo_dia, acumulado, saldo_banco: null as number | null, saldo_anterior: null as number | null }
    })
    dias = dias.map((d) => ({ ...d, saldo_banco: computeSaldoBanco(parseDate(d.data)!) }))
    dias = dias.map((d, i) => ({ ...d, saldo_anterior: i > 0 ? dias[i - 1].saldo_banco : saldoPrimeiroDia }))
    return dias
  }, [apData, recData, saldoData, filters, saldoConfigs])

  const extratoData = useMemo(() => {
    if (!apData || !recData || !saldoData || diasData.length === 0) return []
    const d1 = filters.dtInicio ? new Date(filters.dtInicio + 'T00:00:00') : null
    const d2 = filters.dtFim ? new Date(filters.dtFim + 'T23:59:59') : null
    const emps = filters.empresas
    const obs = filters.obras
    const visList = filters.vis
    const hasRealizado = visList.includes('realizado') || visList.includes('todos') || visList.length === 0
    const hasProjetado = visList.includes('projetado') || visList.includes('todos') || visList.length === 0

    const filteredSaidas = apData.filter((r) => {
      if (d1 || d2) { const rd = parseDate(r.data); if (!rd) return false; if (d1 && rd < d1) return false; if (d2 && rd > d2) return false }
      if (emps.length > 0 && !emps.includes(r.empresa)) return false
      if (obs.length > 0 && !obs.includes(r.obra)) return false
      if (filters.bancos.length > 0 && !filters.bancos.includes(r.banco)) return false
      if (filters.contas.length > 0 && !filters.contas.includes(r.conta)) return false
      const isRealizado = r.origem === 'Pago'
      if (isRealizado && !hasRealizado) return false
      if (!isRealizado && !hasProjetado) return false
      return true
    })

    const filteredEntradas = recData.filter((r) => {
      if (d1 || d2) { const rd = parseDate(r.data); if (!rd) return false; if (d1 && rd < d1) return false; if (d2 && rd > d2) return false }
      if (emps.length > 0 && !emps.includes(r.empresa)) return false
      if (obs.length > 0 && !obs.includes(r.obra)) return false
      if (filters.bancos.length > 0 && r.banco && !filters.bancos.includes(r.banco)) return false
      if (filters.contas.length > 0 && r.conta && !filters.contas.includes(r.conta)) return false
      const isRealizado = r.status === 'Recebida'
      if (isRealizado && !hasRealizado) return false
      if (!isRealizado && !hasProjetado) return false
      return true
    })

    const saldoInicial = diasData[0].saldo_anterior ?? 0

    interface Txn {
      sortKey: number
      data: string
      tipo: 'Entrada' | 'Saída'
      descricao: string
      obra: string
      empresa: string
      entrada: number | null
      saida: number | null
      origem: string
      banco: string
      conta: string
    }

    const transactions: Txn[] = []
    filteredEntradas.forEach((r) => {
      transactions.push({ sortKey: 0, data: r.data, tipo: 'Entrada', descricao: r.cliente || 'N/A', obra: r.obra || 'N/A', empresa: r.empresa, entrada: r.valor, saida: null, origem: r.status, banco: r.banco, conta: r.conta })
    })
    filteredSaidas.forEach((r) => {
      transactions.push({ sortKey: 1, data: r.data, tipo: 'Saída', descricao: r.fornecedor || 'N/A', obra: r.obra || 'N/A', empresa: r.empresa, entrada: null, saida: r.valor, origem: r.origem, banco: r.banco, conta: r.conta })
    })

    transactions.sort((a, b) => {
      const da = parseDate(a.data)
      const db = parseDate(b.data)
      if (!da && !db) return a.sortKey - b.sortKey
      if (!da) return 1
      if (!db) return -1
      const diff = da.getTime() - db.getTime()
      if (diff !== 0) return diff
      return a.sortKey - b.sortKey
    })

    let runningSaldo = saldoInicial
    const result: ExtratoRow[] = [{
      id: 'saldo-inicial', data: diasData[0].data, tipo: 'Saldo Inicial', descricao: 'Saldo Inicial',
      obra: '—', empresa: '—', entrada: null, saida: null, saldo: runningSaldo, origem: '—', banco: '—', conta: '—',
    }]

    transactions.forEach((t, i) => {
      if (t.tipo === 'Entrada') runningSaldo += (t.entrada ?? 0)
      else runningSaldo -= (t.saida ?? 0)
      result.push({
        id: `${t.tipo === 'Entrada' ? 'e' : 's'}-${i}`, data: t.data, tipo: t.tipo, descricao: t.descricao,
        obra: t.obra, empresa: t.empresa, entrada: t.entrada, saida: t.saida, saldo: runningSaldo,
        origem: t.origem, banco: t.banco, conta: t.conta,
      })
    })
    return result
  }, [apData, recData, saldoData, filters, diasData])

  const [searchTags, setSearchTags] = useState<string[]>([])
  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase()
    if (t && !searchTags.includes(t)) setSearchTags((prev) => [...prev, t])
  }
  const removeTag = (i: number) => setSearchTags((prev) => prev.filter((_, idx) => idx !== i))

  const taggedExtratoData = useMemo(() => {
    if (searchTags.length === 0) return extratoData
    return extratoData.filter((r) => {
      if (r.tipo === 'Saldo Inicial') return true
      const text = [r.data, r.tipo, r.descricao, r.obra, r.empresa, r.origem, r.banco, r.conta]
        .join(' ').toLowerCase()
      return searchTags.every((tag) => text.includes(tag))
    })
  }, [extratoData, searchTags])

  const taggedExtratoTotals = useMemo(() => taggedExtratoData.reduce(
    (acc, row) => {
      if (row.tipo === 'Entrada') acc.entrada += row.entrada ?? 0
      if (row.tipo === 'Saída') acc.saida += row.saida ?? 0
      return acc
    },
    { entrada: 0, saida: 0 }
  ), [taggedExtratoData])

  const kpis = useMemo(() => {
    const totalEntradas = diasData.reduce((s, d) => s + d.entradas, 0)
    const totalSaidas = diasData.reduce((s, d) => s + d.saidas, 0)
    const saldo = totalEntradas - totalSaidas
    const diasPositivos = diasData.filter((d) => d.saldo_dia >= 0).length
    return { totalEntradas, totalSaidas, saldo, diasPositivos, totalDias: diasData.length }
  }, [diasData])

  const [chartMode, setChartMode] = useState<'diario' | 'mensal'>('diario')

  useEffect(() => {
    if (!filters.dtInicio || !filters.dtFim) return
    const days = (new Date(filters.dtFim).getTime() - new Date(filters.dtInicio).getTime()) / 86_400_000
    startTransition(() => setChartMode(days > 30 ? 'mensal' : 'diario'))
  }, [filters.dtInicio, filters.dtFim])

  const chartData = useMemo(() =>
    diasData.map((d) => ({ label: d.data, entradas: d.entradas, saidas: d.saidas, acumulado: d.acumulado })),
    [diasData]
  )

  const chartDataMensal = useMemo(() => {
    const byMonth: Record<string, { entradas: number; saidas: number }> = {}
    const order: string[] = []
    diasData.forEach((d) => {
      const parts = d.data.split('/')
      const key = `${parts[1]}/${parts[2]}`
      if (!byMonth[key]) { byMonth[key] = { entradas: 0, saidas: 0 }; order.push(key) }
      byMonth[key].entradas += d.entradas
      byMonth[key].saidas += d.saidas
    })
    let acumulado = 0
    return order.map((key) => {
      acumulado += byMonth[key].entradas - byMonth[key].saidas
      return { label: key, ...byMonth[key], acumulado }
    })
  }, [diasData])

  const necessidadeAporte = useMemo(() => {
    return diasData.map((d, i) => {
      const saldoAnterior = i === 0 ? 0 : diasData[i - 1].acumulado
      const disponivel = i === 0 ? Math.max(d.saldo_banco ?? 0, 0) : Math.max(saldoAnterior, 0)
      const necessidade = d.saidas - d.entradas - disponivel
      return necessidade > 0 ? -necessidade : null
    })
  }, [diasData])

  const obrasBreakdown = useMemo(() => {
    if (!apData || !recData) return { entradasByObra: {}, saidasByObra: {}, obrasEntrada: [], obrasSaida: [] }
    const d1 = filters.dtInicio ? new Date(filters.dtInicio + 'T00:00:00') : null
    const d2 = filters.dtFim ? new Date(filters.dtFim + 'T23:59:59') : null
    const emps = filters.empresas
    const obs = filters.obras
    const hasRealizado = filters.vis.includes('realizado') || filters.vis.includes('todos') || filters.vis.length === 0
    const hasProjetado = filters.vis.includes('projetado') || filters.vis.includes('todos') || filters.vis.length === 0

    const entradasByObra: Record<string, Record<string, number>> = {}
    const saidasByObra: Record<string, Record<string, number>> = {}

    recData.forEach((r) => {
      if (d1 || d2) { const rd = parseDate(r.data); if (!rd || (d1 && rd < d1) || (d2 && rd > d2)) return }
      if (emps.length > 0 && !emps.includes(r.empresa)) return
      if (obs.length > 0 && !obs.includes(r.obra)) return
      if (filters.bancos.length > 0 && r.banco && !filters.bancos.includes(r.banco)) return
      if (filters.contas.length > 0 && r.conta && !filters.contas.includes(r.conta)) return
      const isRealizado = r.status === 'Recebida'
      if (isRealizado && !hasRealizado) return
      if (!isRealizado && !hasProjetado) return
      const obra = r.obra || 'N/A'
      if (!entradasByObra[obra]) entradasByObra[obra] = {}
      entradasByObra[obra][r.data] = (entradasByObra[obra][r.data] || 0) + r.valor
    })

    apData.forEach((r) => {
      if (d1 || d2) { const rd = parseDate(r.data); if (!rd || (d1 && rd < d1) || (d2 && rd > d2)) return }
      if (emps.length > 0 && !emps.includes(r.empresa)) return
      if (obs.length > 0 && !obs.includes(r.obra)) return
      if (filters.bancos.length > 0 && !filters.bancos.includes(r.banco)) return
      if (filters.contas.length > 0 && !filters.contas.includes(r.conta)) return
      const isRealizado = r.origem === 'Pago'
      if (isRealizado && !hasRealizado) return
      if (!isRealizado && !hasProjetado) return
      const obra = r.obra || 'N/A'
      if (!saidasByObra[obra]) saidasByObra[obra] = {}
      saidasByObra[obra][r.data] = (saidasByObra[obra][r.data] || 0) + r.valor
    })

    const obrasEntrada = Object.keys(entradasByObra).sort()
    const obrasSaida = Object.keys(saidasByObra).sort()
    return { entradasByObra, saidasByObra, obrasEntrada, obrasSaida }
  }, [apData, recData, filters])

  const [donutMode, setDonutMode] = useState<'entradas' | 'saidas'>('entradas')

  const { obrasData, totalRecebimento, obrasSaidaData, totalSaidas: totalSaidasObra } = useMemo(() => {
    const CHART_COLORS = ['#2ea043', '#1f6feb', '#d29922', '#8957e5', '#f85149', '#373e47', '#005cc5', '#e36209']
    const formatTopN = (arr: [string, number][], n = 5) => {
      const result = arr.slice(0, n)
      const others = arr.slice(n).reduce((acc, curr) => acc + curr[1], 0)
      if (others > 0) result.push(['Outros', others])
      return result.map(([name, value], i) => ({ name: name || 'N/A', value, color: CHART_COLORS[i % CHART_COLORS.length] }))
    }
    const d1 = filters.dtInicio ? new Date(filters.dtInicio + 'T00:00:00') : null
    const d2 = filters.dtFim ? new Date(filters.dtFim + 'T23:59:59') : null
    const hasRealizado = filters.vis.includes('realizado') || filters.vis.includes('todos') || filters.vis.length === 0
    const hasProjetado = filters.vis.includes('projetado') || filters.vis.includes('todos') || filters.vis.length === 0

    const byObraRec: Record<string, number> = {}
    let totalRec = 0
    if (recData) {
      recData.filter((r) => {
        if (d1 || d2) { const rd = parseDate(r.data); if (!rd || (d1 && rd < d1) || (d2 && rd > d2)) return false }
        if (filters.empresas.length > 0 && !filters.empresas.includes(r.empresa)) return false
        if (filters.obras.length > 0 && !filters.obras.includes(r.obra)) return false
        if (filters.bancos.length > 0 && r.banco && !filters.bancos.includes(r.banco)) return false
        if (filters.contas.length > 0 && r.conta && !filters.contas.includes(r.conta)) return false
        const isRealizado = r.status === 'Recebida'
        if (isRealizado && !hasRealizado) return false
        if (!isRealizado && !hasProjetado) return false
        return true
      }).forEach((r) => { byObraRec[r.obra || 'N/A'] = (byObraRec[r.obra || 'N/A'] || 0) + r.valor; totalRec += r.valor })
    }

    const byObraAP: Record<string, number> = {}
    let totalAP = 0
    if (apData) {
      apData.filter((r) => {
        if (d1 || d2) { const rd = parseDate(r.data); if (!rd || (d1 && rd < d1) || (d2 && rd > d2)) return false }
        if (filters.empresas.length > 0 && !filters.empresas.includes(r.empresa)) return false
        if (filters.obras.length > 0 && !filters.obras.includes(r.obra)) return false
        if (filters.bancos.length > 0 && !filters.bancos.includes(r.banco)) return false
        if (filters.contas.length > 0 && !filters.contas.includes(r.conta)) return false
        const isRealizado = r.origem === 'Pago'
        if (isRealizado && !hasRealizado) return false
        if (!isRealizado && !hasProjetado) return false
        return true
      }).forEach((r) => { byObraAP[r.obra || 'N/A'] = (byObraAP[r.obra || 'N/A'] || 0) + r.valor; totalAP += r.valor })
    }

    return {
      obrasData: formatTopN(Object.entries(byObraRec).sort((a, b) => b[1] - a[1]), 5),
      totalRecebimento: totalRec,
      obrasSaidaData: formatTopN(Object.entries(byObraAP).sort((a, b) => b[1] - a[1]), 5),
      totalSaidas: totalAP,
    }
  }, [recData, apData, filters])

  const extratoExportData = (): { rows: ExtratoRowExport[]; empresaLabel: string; periodoLabel: string } => {
    const empresaLabel = filters.empresas.length > 0 ? filters.empresas.join(', ') : 'Todas as Empresas'
    const periodoLabel = filters.dtInicio && filters.dtFim
      ? (() => { const [y1, m1, d1] = filters.dtInicio!.split('-'); const [y2, m2, d2] = filters.dtFim!.split('-'); return `${d1}/${m1}/${y1} a ${d2}/${m2}/${y2}` })()
      : diasData.length > 0 ? `${diasData[0].data} a ${diasData[diasData.length - 1].data}` : ''
    return { rows: extratoData.map((r) => ({ ...r })), empresaLabel, periodoLabel }
  }

  const handleExtratoPDF = () => { const { rows, empresaLabel, periodoLabel } = extratoExportData(); exportExtratoPDF(rows, empresaLabel, periodoLabel) }
  const handleExtratoXLSX = () => { const { rows, empresaLabel, periodoLabel } = extratoExportData(); exportExtratoXLSX(rows, empresaLabel, periodoLabel) }

  const buildPivotExportData = () => {
    const empresaLabel = filters.empresas.length > 0 ? filters.empresas.join(', ') : 'Todas as Empresas'
    const fmtIso = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
    const periodoLabel = filters.dtInicio && filters.dtFim
      ? `${fmtIso(filters.dtInicio)} a ${fmtIso(filters.dtFim)}`
      : diasData.length > 0 ? `${diasData[0].data} a ${diasData[diasData.length - 1].data}` : ''
    return {
      diasData, entradasByObra: obrasBreakdown.entradasByObra, saidasByObra: obrasBreakdown.saidasByObra,
      obrasEntrada: obrasBreakdown.obrasEntrada, obrasSaida: obrasBreakdown.obrasSaida,
      necessidadeAporte, empresaLabel, periodoLabel, saldoBancario: diasData[0]?.saldo_anterior ?? null,
    }
  }

  const handleExportPDF = () => exportPivotPDF(buildPivotExportData())
  const handleExportXLSX = () => exportPivotXLSX(buildPivotExportData())

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0">
        <FilterSidebar showVis />
        <div className="min-w-0 flex-1 space-y-6 overflow-auto p-5 md:p-7">
          <div className="h-44 bg-white block-border animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-8 h-80 bg-white block-border animate-pulse" />
            <div className="lg:col-span-4 h-80 bg-white block-border animate-pulse" />
          </div>
          <div className="h-96 bg-white block-border animate-pulse" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <FilterSidebar showVis />

      <div className="min-w-0 flex-1 overflow-auto p-5 md:p-7">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">

          {/* Hero KPI */}
          <div className="data-panel lg:col-span-12 flex flex-col justify-between gap-7 p-6 md:p-7 xl:flex-row">
            <div>
              <p className="section-label text-brand">Fluxo de caixa</p>
              <p className="mt-4 text-sm font-medium text-muted-foreground">
                Saldo do período <span className={`ml-2 font-semibold ${kpis.saldo >= 0 ? 'text-positive' : 'text-negative'}`}>{kpis.diasPositivos} dias positivos</span>
              </p>
              <h2 className={`hero-metric mt-2 ${kpis.saldo >= 0 ? 'text-positive' : 'text-negative'}`}>
                {formatCompact(kpis.saldo)}
              </h2>
            </div>
            <div className="grid w-full grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:border-t-0 xl:max-w-xl">
              <div className="metric-cell px-0 pt-4 sm:pt-3">
                <p className="section-label text-positive">Total entradas</p>
                <p className="mt-2 text-2xl font-semibold text-positive">{formatCompact(kpis.totalEntradas)}</p>
              </div>
              <div className="metric-cell px-0 pt-4 sm:pl-5 sm:pt-3">
                <p className="section-label text-negative">Total saídas</p>
                <p className="mt-2 text-2xl font-semibold text-negative">{formatCompact(kpis.totalSaidas)}</p>
              </div>
              <div className="metric-cell px-0 pt-4 sm:pl-5 sm:pt-3">
                <p className="section-label text-brand">Dias positivos</p>
                <p className="mt-2 text-2xl font-semibold text-brand">
                  {kpis.diasPositivos} <span className="text-sm font-medium text-muted-foreground">/ {kpis.totalDias}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Chart: CashFlow */}
          <div className="data-panel lg:col-span-8 flex flex-col p-6 md:p-7">
            <div className="flex justify-between items-end mb-8">
              <h3 className="text-lg font-black uppercase">
                Fluxo de Caixa {chartMode === 'diario' ? 'Diário' : 'Mensal'}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setChartMode('diario')}
                  className={`px-3 py-1 text-xs font-black uppercase transition-colors ${chartMode === 'diario' ? 'bg-dark text-white' : 'border-2 border-dark text-dark hover:bg-bgBase'}`}
                >
                  Diário
                </button>
                <button
                  onClick={() => setChartMode('mensal')}
                  className={`px-3 py-1 text-xs font-black uppercase transition-colors ${chartMode === 'mensal' ? 'bg-dark text-white' : 'border-2 border-dark text-dark hover:bg-bgBase'}`}
                >
                  Mensal
                </button>
              </div>
            </div>
            <div className="flex-1">
              <CashFlowChart data={chartMode === 'diario' ? chartData : chartDataMensal} height={350} />
            </div>
          </div>

          {/* Chart: Donut por Obra */}
          <div className="data-panel lg:col-span-4 flex flex-col p-6 md:p-7">
            <div className="flex justify-between items-end mb-8">
              <h3 className="text-lg font-black uppercase">
                {donutMode === 'entradas' ? 'Entradas' : 'Saídas'} por Obra
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setDonutMode('entradas')}
                  className={`px-3 py-1 text-xs font-black uppercase transition-colors ${donutMode === 'entradas' ? 'bg-dark text-white' : 'border-2 border-dark text-dark hover:bg-bgBase'}`}
                >
                  Entradas
                </button>
                <button
                  onClick={() => setDonutMode('saidas')}
                  className={`px-3 py-1 text-xs font-black uppercase transition-colors ${donutMode === 'saidas' ? 'bg-dark text-white' : 'border-2 border-dark text-dark hover:bg-bgBase'}`}
                >
                  Saídas
                </button>
              </div>
            </div>
            <div className="flex-1 flex flex-col justify-center">
              <DonutChart
                data={donutMode === 'entradas' ? obrasData : obrasSaidaData}
                centerLabel={donutMode === 'entradas' ? 'Entradas' : 'Saídas'}
                centerValue={formatCompact(donutMode === 'entradas' ? totalRecebimento : totalSaidasObra)}
                height={220}
              />
            </div>
          </div>

          {/* Extrato */}
          <div className="data-panel lg:col-span-12 p-6 md:p-7">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
              <h3 className="text-lg font-black uppercase">Extrato de Movimentação Financeira</h3>
              <div className="flex gap-3">
                <button onClick={handleExtratoXLSX} className="flex items-center gap-2 bg-dark text-white font-black uppercase text-xs px-4 py-2 border-2 border-dark hover:bg-brand hover:text-dark transition-colors">
                  <Sheet className="h-4 w-4" />XLSX
                </button>
                <button onClick={handleExtratoPDF} className="flex items-center gap-2 bg-dark text-white font-black uppercase text-xs px-4 py-2 border-2 border-dark hover:bg-brand hover:text-dark transition-colors">
                  <FileText className="h-4 w-4" />PDF
                </button>
              </div>
            </div>
            <DataTable
              data={taggedExtratoData}
              columns={extratoCols as ColumnDef<ExtratoRow, unknown>[]}
              searchPlaceholder="Buscar e pressione Enter para filtrar..."
              pageSize={50}
              searchTags={searchTags}
              onAddTag={addTag}
              onRemoveTag={removeTag}
              footerRow={
                <tr className="border-t-2 border-dark bg-bgBase font-black">
                  <td colSpan={4} className="px-4 py-3 text-right text-xs font-black uppercase text-gray-500">
                    {searchTags.length > 0 ? 'Total Filtrado' : 'Total'}
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-black uppercase text-gray-500">—</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700 font-black">{formatCurrency(taggedExtratoTotals.entrada)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-700 font-black">{formatCurrency(taggedExtratoTotals.saida)}</td>
                  <td></td>
                </tr>
              }
            />
          </div>

          {/* Pivot Table */}
          <div className="data-panel lg:col-span-12 p-6 md:p-7">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
              <h3 className="text-lg font-black uppercase">Fluxo de Caixa por Dia</h3>
              <div className="flex gap-3">
                <button onClick={handleExportXLSX} className="flex items-center gap-2 bg-dark text-white font-black uppercase text-xs px-4 py-2 border-2 border-dark hover:bg-brand hover:text-dark transition-colors">
                  <Sheet className="h-4 w-4" />XLSX
                </button>
                <button onClick={handleExportPDF} className="flex items-center gap-2 bg-dark text-white font-black uppercase text-xs px-4 py-2 border-2 border-dark hover:bg-brand hover:text-dark transition-colors">
                  <FileText className="h-4 w-4" />PDF
                </button>
              </div>
            </div>
            <div className="overflow-x-auto block-border">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-dark bg-bgBase">
                    <th className="sticky left-0 bg-bgBase z-10 text-left px-4 py-3 font-black uppercase text-dark min-w-[160px] border-b-2 border-dark">Rótulos de Linha</th>
                    {diasData.map((d) => (
                      <th key={d.data} className="text-right px-3 py-3 font-black uppercase text-dark whitespace-nowrap min-w-[100px] border-b-2 border-dark">{d.data}</th>
                    ))}
                    <th className="text-right px-3 py-3 font-black uppercase text-dark whitespace-nowrap min-w-[110px] border-b-2 border-dark">Total Geral</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-grid bg-emerald-50">
                    <td className="sticky left-0 z-10 px-4 py-2 font-black bg-emerald-50">— Entrada</td>
                    {diasData.map((d) => (
                      <td key={d.data} className="text-right px-3 py-2 tabular-nums font-black text-emerald-700">
                        {d.entradas > 0 ? formatCurrency(d.entradas) : <span className="text-grid">-</span>}
                      </td>
                    ))}
                    <td className="text-right px-3 py-2 tabular-nums font-black text-emerald-700">
                      {formatCurrency(diasData.reduce((s, d) => s + d.entradas, 0))}
                    </td>
                  </tr>
                  {obrasBreakdown.obrasEntrada.map((obra) => {
                    const byDate = obrasBreakdown.entradasByObra[obra]
                    const total = Object.values(byDate).reduce((s: number, v) => s + v, 0)
                    return (
                      <tr key={`e-${obra}`} className="border-b border-grid">
                        <td className="sticky left-0 z-10 px-4 py-1.5 pl-8 text-muted-foreground bg-white">{obra}</td>
                        {diasData.map((d) => (
                          <td key={d.data} className="text-right px-3 py-1.5 tabular-nums text-emerald-600">
                            {byDate[d.data] ? formatCurrency(byDate[d.data]) : <span className="text-grid">-</span>}
                          </td>
                        ))}
                        <td className="text-right px-3 py-1.5 tabular-nums text-emerald-600 font-bold">{formatCurrency(total)}</td>
                      </tr>
                    )
                  })}
                  <tr className="border-b border-grid bg-red-50">
                    <td className="sticky left-0 z-10 px-4 py-2 font-black bg-red-50">— Saída</td>
                    {diasData.map((d) => (
                      <td key={d.data} className="text-right px-3 py-2 tabular-nums font-black text-red-700">
                        {d.saidas > 0 ? formatCurrency(d.saidas) : <span className="text-grid">-</span>}
                      </td>
                    ))}
                    <td className="text-right px-3 py-2 tabular-nums font-black text-red-700">
                      {formatCurrency(diasData.reduce((s, d) => s + d.saidas, 0))}
                    </td>
                  </tr>
                  {obrasBreakdown.obrasSaida.map((obra) => {
                    const byDate = obrasBreakdown.saidasByObra[obra]
                    const total = Object.values(byDate).reduce((s: number, v) => s + v, 0)
                    return (
                      <tr key={`s-${obra}`} className="border-b border-grid">
                        <td className="sticky left-0 z-10 px-4 py-1.5 pl-8 text-muted-foreground bg-white">{obra}</td>
                        {diasData.map((d) => (
                          <td key={d.data} className="text-right px-3 py-1.5 tabular-nums text-red-600">
                            {byDate[d.data] ? formatCurrency(byDate[d.data]) : <span className="text-grid">-</span>}
                          </td>
                        ))}
                        <td className="text-right px-3 py-1.5 tabular-nums text-red-600 font-bold">{formatCurrency(total)}</td>
                      </tr>
                    )
                  })}
                  <tr className="border-b border-grid">
                    <td className="sticky left-0 bg-white z-10 px-4 py-2 font-black">Saldo Acumulado</td>
                    {diasData.map((d) => (
                      <td key={d.data} className={`text-right px-3 py-2 tabular-nums font-black ${d.acumulado >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {formatCurrency(d.acumulado)}
                      </td>
                    ))}
                    <td className="text-right px-3 py-2 tabular-nums font-black text-muted-foreground">-</td>
                  </tr>
                  <tr className="bg-orange-50">
                    <td className="sticky left-0 z-10 px-4 py-2 font-black bg-orange-50">Necessidade de Aporte</td>
                    {necessidadeAporte.map((v, i) => (
                      <td key={diasData[i].data} className="text-right px-3 py-2 tabular-nums font-black text-red-700">
                        {v !== null ? formatCurrency(v) : <span className="text-grid">-</span>}
                      </td>
                    ))}
                    <td className="text-right px-3 py-2 tabular-nums font-black text-red-700">
                      {(() => { const t = necessidadeAporte.reduce((s: number, v) => s + (v ?? 0), 0); return t !== 0 ? formatCurrency(t) : <span className="text-grid">-</span> })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
