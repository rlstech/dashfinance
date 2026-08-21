import autoTable from 'jspdf-autotable'
import type { FluxoPlanejamentoResponse, GrupoObras, Periodo } from '@/types'
import { formatCurrency } from './formatters'
import {
  createReport, drawMetaRow, drawKpiRow, drawFooter, drawCompactBand,
  baseTableStyles, nowStamp,
  INK, AMBER, POSITIVE, NEGATIVE, WHITE, ZEBRA, MARGIN_X,
  type RGB, type ReportHandle,
} from './pdfReport'

export type ObraRender = FluxoPlanejamentoResponse & {
  _isEspecial?: boolean
  _recRealizadaPct?: number[]
}

export type DemaisObrasData = FluxoPlanejamentoResponse & {
  _greedyCount: number
  _greedyEmpresas: string[]
}

export interface FluxoObrasExportData {
  grupo: GrupoObras
  periodo: Periodo
  colunas: { label: string }[]
  obras: ObraRender[]
  consolidado: {
    custoReal: number[]
    recReal: number[]
    saldoMes: number[]
    saldoAcc: number[]
  }
  demaisObras?: DemaisObrasData | null
}

const TITULO = 'Fluxo de Caixa Gerencial de Obras'

// Faixa neutra para as seções por obra; o destaque fica na barra âmbar.
const BAND_SECAO: RGB = [237, 242, 244]

const PAGE_H = 210
const CONTENT_W = 281
const LABEL_W = 38
const TOTAL_W = 22

const FONT = 7
const CELL_PAD = 1.5

function fmt(v: number): string {
  if (v === 0) return ''
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v)
}

type SectionRow = {
  label: string
  values: number[]
  total?: number
  emphasis?: boolean // saldo acumulado, fluxo acumulado
}

function totalOf(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0)
}

function buildBody(rows: SectionRow[]): string[][] {
  return rows.map((r) => {
    const tot = r.total !== undefined ? r.total : totalOf(r.values)
    return [r.label, ...r.values.map(fmt), fmt(tot)]
  })
}

// Reserva vertical antes de iniciar uma seção; quebra de página se faltar
// espaço, já descontando a faixa do rodapé.
function ensureSpace(r: ReportHandle, currentY: number, needed: number, scope: string): number {
  if (currentY + needed > PAGE_H - 14) {
    r.doc.addPage()
    return drawCompactBand(r, TITULO, scope)
  }
  return currentY
}

// Título de seção em faixa; `accent` desenha a barra vertical à esquerda.
function drawBanner(
  r: ReportHandle,
  y: number,
  text: string,
  rightText: string | undefined,
  fill: RGB,
  textColor: RGB,
  accent?: RGB,
): number {
  const { doc } = r
  const h = 6.5
  doc.setFillColor(...fill)
  doc.rect(MARGIN_X, y, CONTENT_W, h, 'F')
  if (accent) {
    doc.setFillColor(...accent)
    doc.rect(MARGIN_X, y, 1.5, h, 'F')
  }
  doc.setTextColor(...textColor)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text(text, MARGIN_X + (accent ? 4 : 2), y + h - 2)
  if (rightText) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(rightText, MARGIN_X + CONTENT_W - 2, y + h - 2, { align: 'right' })
  }
  return y + h
}

function makeColStyles(nCols: number): Record<number, object> {
  const monthW = (CONTENT_W - LABEL_W - TOTAL_W) / nCols
  const styles: Record<number, object> = {
    0: { halign: 'left', cellWidth: LABEL_W, fontStyle: 'bold' },
    [nCols + 1]: { cellWidth: TOTAL_W, fontStyle: 'bold' },
  }
  for (let i = 1; i <= nCols; i++) {
    styles[i] = { cellWidth: monthW }
  }
  return styles
}

function renderTable(
  r: ReportHandle,
  startY: number,
  rows: SectionRow[],
  colunas: { label: string }[],
  scope: string,
): number {
  const { doc } = r
  const nCols = colunas.length
  const headers = ['Métrica', ...colunas.map((c) => c.label), 'Total']
  const body = buildBody(rows)
  const cellPad = nCols > 14 ? 1.0 : CELL_PAD
  const base = baseTableStyles(FONT)

  autoTable(doc, {
    ...base,
    startY,
    head: [headers],
    body,
    tableWidth: CONTENT_W,
    margin: { left: MARGIN_X, right: MARGIN_X, top: 20, bottom: 14 },
    styles: {
      ...base.styles,
      cellPadding: { top: cellPad, bottom: cellPad, left: cellPad, right: cellPad },
    },
    columnStyles: makeColStyles(nCols),
    didParseCell: (hookData) => {
      if (hookData.section === 'head') {
        if (hookData.column.index === 0) hookData.cell.styles.halign = 'left'
        return
      }
      if (hookData.section !== 'body') return
      const row = rows[hookData.row.index]
      if (!row) return

      if (row.emphasis) {
        hookData.cell.styles.fillColor = ZEBRA
        hookData.cell.styles.fontStyle = 'bold'
        hookData.cell.styles.lineWidth = { top: 0.3, right: 0, bottom: 0.1, left: 0 }
      }
      // Negativos em vermelho em qualquer linha; positivos com ênfase em verde.
      const raw = hookData.cell.raw as string
      if (hookData.column.index > 0 && typeof raw === 'string' && raw !== '') {
        if (raw.startsWith('-')) hookData.cell.styles.textColor = NEGATIVE
        else if (row.emphasis) hookData.cell.styles.textColor = POSITIVE
      }
      if (hookData.column.index === 0) {
        hookData.cell.styles.halign = 'left'
      }
    },
    didDrawPage: (hook) => {
      if (hook.pageNumber > 1) drawCompactBand(r, TITULO, scope)
    },
  })

  // @ts-expect-error — finalY é anexado pelo plugin
  return (doc.lastAutoTable?.finalY as number) ?? startY
}

function buildConsolidadoRows(d: FluxoObrasExportData['consolidado']): SectionRow[] {
  return [
    { label: 'Custo Real', values: d.custoReal, total: totalOf(d.custoReal) },
    { label: 'Receita Realizada', values: d.recReal, total: totalOf(d.recReal) },
    { label: 'Saldo do Mês', values: d.saldoMes, total: totalOf(d.saldoMes) },
    { label: 'Saldo Acumulado', values: d.saldoAcc, total: d.saldoAcc[d.saldoAcc.length - 1], emphasis: true },
  ]
}

function buildObraRows(obra: ObraRender): SectionRow[] {
  const meses = obra.meses
  const custoPrev = meses.map((m) => m.custo_previsto)
  const custoReal = meses.map((m) => m.custo_real)
  const recPrev = meses.map((m) => m.receita_prevista)

  let accPlan = 0
  const accumuladoPlan = meses.map((m) => {
    accPlan += m.receita_prevista - m.custo_previsto
    return accPlan
  })

  if (obra._isEspecial && obra._recRealizadaPct) {
    const recRealPct = obra._recRealizadaPct
    const recFinanceira = meses.map((m) => m.receita_realizada)
    let accReal = 0
    const accumuladoReal = meses.map((m, i) => {
      accReal += (recRealPct[i] + recFinanceira[i]) - m.custo_real
      return accReal
    })
    return [
      { label: 'Custo Previsto', values: custoPrev },
      { label: 'Custo Real', values: custoReal },
      { label: 'Receita Prevista (%)', values: recPrev },
      { label: 'Receita Realizada (%)', values: recRealPct },
      { label: 'Receita Financeira', values: recFinanceira },
      { label: 'Fluxo Acumulado Planejado', values: accumuladoPlan, total: accumuladoPlan[accumuladoPlan.length - 1], emphasis: true },
      { label: 'Fluxo Acumulado Real', values: accumuladoReal, total: accumuladoReal[accumuladoReal.length - 1], emphasis: true },
    ]
  }

  const recReal = meses.map((m) => m.receita_realizada)
  let accReal = 0
  const accumuladoReal = meses.map((m, i) => {
    accReal += recReal[i] - m.custo_real
    return accReal
  })
  return [
    { label: 'Custo Previsto', values: custoPrev },
    { label: 'Custo Real', values: custoReal },
    { label: 'Receita Prevista', values: recPrev },
    { label: 'Receita Realizada', values: recReal },
    { label: 'Fluxo Acumulado Planejado', values: accumuladoPlan, total: accumuladoPlan[accumuladoPlan.length - 1], emphasis: true },
    { label: 'Fluxo Acumulado Real', values: accumuladoReal, total: accumuladoReal[accumuladoReal.length - 1], emphasis: true },
  ]
}

function buildDemaisObrasRows(d: DemaisObrasData): SectionRow[] {
  const meses = d.meses
  const recReal = meses.map((m) => m.receita_realizada)
  const custoReal = meses.map((m) => m.custo_real)
  let accReal = 0
  const accumuladoReal = meses.map((_, i) => {
    accReal += recReal[i] - custoReal[i]
    return accReal
  })
  return [
    { label: 'Custo Previsto', values: meses.map((m) => m.custo_previsto) },
    { label: 'Receita Prevista', values: meses.map((m) => m.receita_prevista) },
    { label: 'Custo Real', values: custoReal },
    { label: 'Receita Realizada', values: recReal },
    { label: 'Fluxo Acumulado Real', values: accumuladoReal, total: accumuladoReal[accumuladoReal.length - 1], emphasis: true },
  ]
}

export function exportFluxoObrasPDF(data: FluxoObrasExportData): void {
  const { grupo, periodo, colunas, obras, consolidado, demaisObras } = data

  const r = createReport({ orientation: 'landscape', title: TITULO, scope: grupo.nome })
  const { doc } = r

  const periodoLabel = colunas.length > 0
    ? `${colunas[0].label} a ${colunas[colunas.length - 1].label}`
    : String(periodo.anoInicio)
  const obrasCount = obras.length

  drawMetaRow(r, [
    { label: 'Período', value: periodoLabel },
    { label: 'Obras no grupo', value: String(obrasCount) },
    { label: 'Gerado em', value: nowStamp() },
  ])

  if (grupo.descricao) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK)
    doc.text(grupo.descricao, MARGIN_X, r.y)
    r.y += 6
  }

  const totalCustoReal = totalOf(consolidado.custoReal)
  const totalRecReal = totalOf(consolidado.recReal)
  const saldoAnual = totalRecReal - totalCustoReal

  drawKpiRow(r, [
    { label: 'Custo real', value: formatCurrency(totalCustoReal), tone: NEGATIVE },
    { label: 'Receita realizada', value: formatCurrency(totalRecReal), tone: POSITIVE },
    { label: 'Saldo', value: formatCurrency(saldoAnual), tone: saldoAnual < 0 ? NEGATIVE : POSITIVE },
  ])

  let y = r.y

  // ── Seção: Consolidado ────────────────────────────────────────────────────
  y = drawBanner(
    r,
    y,
    'CONSOLIDADO OPERACIONAL DO GRUPO',
    `${obrasCount} obra(s)${demaisObras ? ` · inclui Demais Obras (${demaisObras._greedyCount})` : ''}`,
    INK,
    WHITE,
  )
  y = renderTable(r, y, buildConsolidadoRows(consolidado), colunas, grupo.nome)
  y += 6

  // ── Seção por obra ────────────────────────────────────────────────────────
  for (const obra of obras) {
    const rows = buildObraRows(obra)
    const estTableH = (rows.length + 1) * (FONT * 0.55) + 8 // estimativa conservadora
    y = ensureSpace(r, y, 8 + estTableH, grupo.nome)
    y = drawBanner(
      r,
      y,
      `OBRA: ${obra.obra_codigo}${obra._isEspecial ? '  ·  ESPECIAL' : ''}`,
      undefined,
      BAND_SECAO,
      INK,
      AMBER,
    )
    y = renderTable(r, y, rows, colunas, grupo.nome)
    y += 5
  }

  // ── Seção: Demais Obras ───────────────────────────────────────────────────
  if (demaisObras) {
    const rows = buildDemaisObrasRows(demaisObras)
    const estTableH = (rows.length + 1) * (FONT * 0.55) + 8
    y = ensureSpace(r, y, 8 + estTableH, grupo.nome)
    y = drawBanner(
      r,
      y,
      `DEMAIS OBRAS  ·  ${demaisObras._greedyCount} obra(s)  ·  ${demaisObras._greedyEmpresas.join(', ')}`,
      undefined,
      ZEBRA,
      INK,
      AMBER,
    )
    y = renderTable(r, y, rows, colunas, grupo.nome)
  }

  drawFooter(r, `${grupo.nome} · ${periodoLabel}`)

  const safeName = grupo.nome.replace(/[^a-zA-Z0-9]/g, '_')
  const periodoStr = colunas.length > 0
    ? `${colunas[0].label}_${colunas[colunas.length - 1].label}`.replace(/\//g, '')
    : String(periodo.anoInicio)
  doc.save(`fluxo_obras_${safeName}_${periodoStr}.pdf`)
}
