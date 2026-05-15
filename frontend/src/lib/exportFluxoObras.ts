import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { FluxoPlanejamentoResponse, GrupoObras } from '@/types'

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
  ano: number
  obras: ObraRender[]
  consolidado: {
    custoReal: number[]
    recReal: number[]
    saldoMes: number[]
    saldoAcc: number[]
  }
  demaisObras?: DemaisObrasData | null
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// Paleta — alinhada com exportPivot.ts
const COLOR_HEADER_BG: [number, number, number] = [40, 40, 40]
const COLOR_BAND_DARK: [number, number, number] = [30, 30, 30]
const COLOR_BAND_ACCENT: [number, number, number] = [244, 177, 131]
const COLOR_BAND_OBRA: [number, number, number] = [252, 228, 214]
const COLOR_ACC_ROW: [number, number, number] = [242, 242, 242]
const COLOR_NEG: [number, number, number] = [192, 0, 0]
const COLOR_WHITE: [number, number, number] = [255, 255, 255]
const COLOR_DARK: [number, number, number] = [30, 30, 30]
const COLOR_RULE: [number, number, number] = [200, 200, 200]

const PAGE_W = 297
const PAGE_H = 210
const MARGIN_X = 8

const CONTENT_W = PAGE_W - MARGIN_X * 2 // 281
const LABEL_W = 38
const TOTAL_W = 22
const MONTH_W = (CONTENT_W - LABEL_W - TOTAL_W) / 12

const FONT = 7
const CELL_PAD = 1.5

function fmt(v: number): string {
  if (v === 0) return ''
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v)
}

function fmtCurrencyHeader(v: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(v)
}

function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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

// Reserva vertical antes de iniciar uma seção; quebra de página se faltar espaço
function ensureSpace(doc: jsPDF, currentY: number, needed: number): number {
  if (currentY + needed > PAGE_H - MARGIN_X) {
    doc.addPage()
    return MARGIN_X + 4
  }
  return currentY
}

// Renderiza um título de seção em forma de banner colorido
function drawBanner(
  doc: jsPDF,
  y: number,
  text: string,
  rightText: string | undefined,
  fill: [number, number, number],
  textColor: [number, number, number],
): number {
  const h = 6.5
  doc.setFillColor(...fill)
  doc.rect(MARGIN_X, y, CONTENT_W, h, 'F')
  doc.setTextColor(...textColor)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text(text, MARGIN_X + 2, y + h - 2)
  if (rightText) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(rightText, MARGIN_X + CONTENT_W - 2, y + h - 2, { align: 'right' })
  }
  return y + h
}

function makeColStyles(): Record<number, object> {
  const styles: Record<number, object> = {
    0: { halign: 'left', cellWidth: LABEL_W, fontStyle: 'bold' },
    13: { cellWidth: TOTAL_W, fontStyle: 'bold' },
  }
  for (let i = 1; i <= 12; i++) {
    styles[i] = { cellWidth: MONTH_W }
  }
  return styles
}

function renderTable(
  doc: jsPDF,
  startY: number,
  rows: SectionRow[],
): number {
  const headers = ['Métrica', ...MESES, 'Total']
  const body = buildBody(rows)

  autoTable(doc, {
    startY,
    head: [headers],
    body,
    theme: 'grid',
    tableWidth: CONTENT_W,
    margin: { left: MARGIN_X, right: MARGIN_X, top: MARGIN_X + 4, bottom: MARGIN_X },
    styles: {
      fontSize: FONT,
      cellPadding: { top: CELL_PAD, bottom: CELL_PAD, left: CELL_PAD, right: CELL_PAD },
      halign: 'right',
      overflow: 'linebreak',
      lineColor: COLOR_RULE,
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: COLOR_HEADER_BG,
      textColor: COLOR_WHITE,
      fontStyle: 'bold',
      fontSize: FONT,
      halign: 'center',
    },
    columnStyles: makeColStyles(),
    didParseCell: (hookData) => {
      if (hookData.section !== 'body') return
      const row = rows[hookData.row.index]
      if (!row) return

      if (row.emphasis) {
        hookData.cell.styles.fillColor = COLOR_ACC_ROW
        hookData.cell.styles.fontStyle = 'bold'
        hookData.cell.styles.textColor = COLOR_DARK
      }
      // Coloração: negativos em vermelho (qualquer linha)
      const raw = hookData.cell.raw as string
      if (typeof raw === 'string' && raw.startsWith('-')) {
        hookData.cell.styles.textColor = COLOR_NEG
      }
      // Label sempre alinhado à esquerda mesmo em colunas com halign right
      if (hookData.column.index === 0) {
        hookData.cell.styles.halign = 'left'
      }
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
    { label: 'Saldo Acumulado', values: d.saldoAcc, total: d.saldoAcc[11], emphasis: true },
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
      { label: 'Fluxo Acumulado Planejado', values: accumuladoPlan, total: accumuladoPlan[11], emphasis: true },
      { label: 'Fluxo Acumulado Real', values: accumuladoReal, total: accumuladoReal[11], emphasis: true },
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
    { label: 'Fluxo Acumulado Planejado', values: accumuladoPlan, total: accumuladoPlan[11], emphasis: true },
    { label: 'Fluxo Acumulado Real', values: accumuladoReal, total: accumuladoReal[11], emphasis: true },
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
    { label: 'Fluxo Acumulado Real', values: accumuladoReal, total: accumuladoReal[11], emphasis: true },
  ]
}

export function exportFluxoObrasPDF(data: FluxoObrasExportData): void {
  const { grupo, ano, obras, consolidado, demaisObras } = data
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  let y = 12
  doc.setTextColor(...COLOR_DARK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('FLUXO DE CAIXA GERENCIAL DE OBRAS', MARGIN_X, y)
  y += 6

  doc.setFontSize(11)
  doc.text(grupo.nome.toUpperCase(), MARGIN_X, y)
  y += 5

  if (grupo.descricao) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(grupo.descricao, MARGIN_X, y)
    y += 4.5
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const obrasCount = obras.length
  doc.text(
    `ANO: ${ano}  ·  OBRAS NO GRUPO: ${obrasCount}  ·  GERADO EM: ${nowStamp()}`,
    MARGIN_X,
    y,
  )
  y += 3

  // Filete separador
  doc.setDrawColor(...COLOR_DARK)
  doc.setLineWidth(0.4)
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y)
  y += 4

  // Resumo executivo numérico no cabeçalho
  const totalCustoReal = totalOf(consolidado.custoReal)
  const totalRecReal = totalOf(consolidado.recReal)
  const saldoAnual = totalRecReal - totalCustoReal
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text(`CUSTO REAL: ${fmtCurrencyHeader(totalCustoReal)}`, MARGIN_X, y)
  doc.text(
    `RECEITA REALIZADA: ${fmtCurrencyHeader(totalRecReal)}`,
    MARGIN_X + 95,
    y,
  )
  if (saldoAnual < 0) doc.setTextColor(...COLOR_NEG)
  doc.text(`SALDO: ${fmtCurrencyHeader(saldoAnual)}`, MARGIN_X + 195, y)
  doc.setTextColor(...COLOR_DARK)
  y += 6

  // ── Seção: Consolidado ────────────────────────────────────────────────────
  y = drawBanner(
    doc,
    y,
    'CONSOLIDADO OPERACIONAL DO GRUPO',
    `${obrasCount} obra(s)${demaisObras ? ` · inclui Demais Obras (${demaisObras._greedyCount})` : ''}`,
    COLOR_BAND_DARK,
    COLOR_WHITE,
  )
  y = renderTable(doc, y, buildConsolidadoRows(consolidado))
  y += 6

  // ── Seção por obra ────────────────────────────────────────────────────────
  for (const obra of obras) {
    const rows = buildObraRows(obra)
    const estTableH = (rows.length + 1) * (FONT * 0.55) + 8 // estimativa conservadora
    y = ensureSpace(doc, y, 8 + estTableH)
    y = drawBanner(
      doc,
      y,
      `OBRA: ${obra.obra_codigo}${obra._isEspecial ? '  ·  ESPECIAL' : ''}`,
      undefined,
      COLOR_BAND_ACCENT,
      COLOR_DARK,
    )
    y = renderTable(doc, y, rows)
    y += 5
  }

  // ── Seção: Demais Obras ───────────────────────────────────────────────────
  if (demaisObras) {
    const rows = buildDemaisObrasRows(demaisObras)
    const estTableH = (rows.length + 1) * (FONT * 0.55) + 8
    y = ensureSpace(doc, y, 8 + estTableH)
    y = drawBanner(
      doc,
      y,
      `DEMAIS OBRAS  ·  ${demaisObras._greedyCount} obra(s)  ·  ${demaisObras._greedyEmpresas.join(', ')}`,
      undefined,
      COLOR_BAND_OBRA,
      COLOR_DARK,
    )
    y = renderTable(doc, y, rows)
  }

  // ── Rodapé com paginação ──────────────────────────────────────────────────
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(120, 120, 120)
    doc.text(
      `${grupo.nome} · ${ano}`,
      MARGIN_X,
      PAGE_H - 4,
    )
    doc.text(
      `Página ${i} de ${total}`,
      PAGE_W - MARGIN_X,
      PAGE_H - 4,
      { align: 'right' },
    )
  }

  const safeName = grupo.nome.replace(/[^a-zA-Z0-9]/g, '_')
  doc.save(`fluxo_obras_${safeName}_${ano}.pdf`)
}
