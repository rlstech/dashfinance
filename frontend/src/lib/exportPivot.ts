import autoTable from 'jspdf-autotable'
import * as XLSX from '@e965/xlsx'
import { formatCurrency } from './formatters'
import {
  createReport, drawMetaRow, drawKpiRow, drawFooter, drawCompactBand,
  baseTableStyles, nowStamp, saveReport, buildReportFilename,
  INK, MUTED, POSITIVE, NEGATIVE, ZEBRA, MARGIN_X,
  type RGB,
} from './pdfReport'

export interface DiaDataExport {
  data: string
  entradas: number
  saidas: number
  acumulado: number
  saldo_anterior: number | null
}

export interface PivotExportData {
  diasData: DiaDataExport[]
  entradasByObra: Record<string, Record<string, number>>
  saidasByObra: Record<string, Record<string, number>>
  obrasEntrada: string[]
  obrasSaida: string[]
  necessidadeAporte: (number | null)[]
  empresaLabel: string
  periodoLabel: string
  saldoBancario: number | null
}

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(v: number | null): string {
  if (v === null || v === undefined) return ''
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

function buildHeaders(dias: DiaDataExport[]): string[] {
  return ['Rótulos de Linha', ...dias.map(d => d.data.slice(0, 5)), 'Total']
}

// Returns rows as { label, values, type }
function buildRowData(data: PivotExportData) {
  const { diasData, entradasByObra, saidasByObra, obrasEntrada, obrasSaida, necessidadeAporte } = data

  const rows: { label: string; cells: string[]; type: 'group-entrada' | 'group-saida' | 'sub' | 'saldo' | 'aporte' }[] = []

  // Entrada total
  const totEntrada = diasData.map(d => d.entradas)
  const sumEntrada = totEntrada.reduce((s, v) => s + v, 0)
  rows.push({
    label: '— Entrada',
    cells: [...totEntrada.map(v => v > 0 ? fmt(v) : ''), fmt(sumEntrada)],
    type: 'group-entrada',
  })

  // Entrada sub-obras
  for (const obra of obrasEntrada) {
    const byDate = entradasByObra[obra] ?? {}
    const vals = diasData.map(d => byDate[d.data] ?? 0)
    const total = vals.reduce((s, v) => s + v, 0)
    rows.push({
      label: `   ${obra}`,
      cells: [...vals.map(v => v > 0 ? fmt(v) : ''), fmt(total)],
      type: 'sub',
    })
  }

  // Saída total
  const totSaida = diasData.map(d => d.saidas)
  const sumSaida = totSaida.reduce((s, v) => s + v, 0)
  rows.push({
    label: '— Saída',
    cells: [...totSaida.map(v => v > 0 ? fmt(v) : ''), fmt(sumSaida)],
    type: 'group-saida',
  })

  // Saída sub-obras
  for (const obra of obrasSaida) {
    const byDate = saidasByObra[obra] ?? {}
    const vals = diasData.map(d => byDate[d.data] ?? 0)
    const total = vals.reduce((s, v) => s + v, 0)
    rows.push({
      label: `   ${obra}`,
      cells: [...vals.map(v => v > 0 ? fmt(v) : ''), fmt(total)],
      type: 'sub',
    })
  }

  // Saldo acumulado
  rows.push({
    label: 'Saldo Acumulado',
    cells: [...diasData.map(d => fmt(d.acumulado)), ''],
    type: 'saldo',
  })

  // Necessidade de aporte
  const totalAporte = necessidadeAporte.reduce((s: number, v) => s + (v ?? 0), 0)
  rows.push({
    label: 'Necessidade de Aporte',
    cells: [...necessidadeAporte.map(v => v !== null ? fmt(v) : ''), totalAporte !== 0 ? fmt(totalAporte) : ''],
    type: 'aporte',
  })

  return rows
}

// ─── PDF ────────────────────────────────────────────────────────────────────

const TITULO_PIVOT = 'Fluxo de Caixa Diário'

// Larguras fixas da coluna de rótulos e do total; os dias dividem o que sobra.
const LABEL_W = 34
const TOTAL_W = 24
// Abaixo disso um valor em reais deixa de caber com folga — em vez de encolher
// a fonte (o que tornava um trimestre ilegível), fatiamos os dias em blocos.
const MIN_DAY_W = 15
const MAX_DAY_W = 30

function toneDoValor(v: number): RGB {
  return v < 0 ? NEGATIVE : POSITIVE
}

export function exportPivotPDF(data: PivotExportData): void {
  const { diasData, empresaLabel, periodoLabel, saldoBancario } = data

  const r = createReport({ orientation: 'landscape', title: TITULO_PIVOT, scope: empresaLabel })
  const { doc } = r

  drawMetaRow(r, [
    { label: 'Período', value: periodoLabel || '—' },
    { label: 'Saldo bancário', value: saldoBancario !== null ? formatCurrency(saldoBancario) : 'N/D' },
    { label: 'Gerado em', value: nowStamp() },
  ])

  const totalEntradas = diasData.reduce((s, d) => s + d.entradas, 0)
  const totalSaidas = diasData.reduce((s, d) => s + d.saidas, 0)
  const resultado = totalEntradas - totalSaidas
  const saldoFinal = diasData.length > 0 ? diasData[diasData.length - 1].acumulado : 0

  drawKpiRow(r, [
    { label: 'Entradas', value: formatCurrency(totalEntradas), tone: POSITIVE },
    { label: 'Saídas', value: formatCurrency(totalSaidas), tone: NEGATIVE },
    { label: 'Resultado', value: formatCurrency(resultado), tone: toneDoValor(resultado) },
    { label: 'Saldo final', value: formatCurrency(saldoFinal), tone: toneDoValor(saldoFinal) },
  ])

  const rowData = buildRowData(data)
  const nDias = diasData.length
  const maxPorBloco = Math.max(1, Math.floor((r.contentW - LABEL_W - TOTAL_W) / MIN_DAY_W))

  // Blocos de tamanho uniforme: com 45 dias e teto de 14, sai 12/11/11/11 em
  // vez de 14/14/14/3 — a última página não fica quase vazia.
  const nBlocos = Math.max(1, Math.ceil(nDias / maxPorBloco))
  const tamanhoBase = Math.floor(nDias / nBlocos)
  const resto = nDias % nBlocos

  const blocos: DiaDataExport[][] = []
  let cursor = 0
  for (let i = 0; i < nBlocos; i++) {
    const tamanho = tamanhoBase + (i < resto ? 1 : 0)
    blocos.push(diasData.slice(cursor, cursor + tamanho))
    cursor += tamanho
  }

  blocos.forEach((bloco, bi) => {
    const ultimo = bi === blocos.length - 1
    const inicio = blocos.slice(0, bi).reduce((acc, b) => acc + b.length, 0)

    if (bi > 0) {
      doc.addPage()
      r.y = drawCompactBand(r, TITULO_PIVOT, empresaLabel)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      const faixa = bloco.length > 0 ? `${bloco[0].data} a ${bloco[bloco.length - 1].data}` : ''
      doc.text(`Continuação · ${faixa}`, MARGIN_X, r.y)
      r.y += 5
    }

    const headers = [
      'Rótulos de Linha',
      ...bloco.map((d) => d.data.slice(0, 5)),
      ...(ultimo ? ['Total'] : []),
    ]
    const bodyRows = rowData.map((row) => [
      row.label,
      ...row.cells.slice(inicio, inicio + bloco.length),
      ...(ultimo ? [row.cells[row.cells.length - 1]] : []),
    ])

    const disponivel = r.contentW - LABEL_W - (ultimo ? TOTAL_W : 0)
    const dayW = Math.min(MAX_DAY_W, disponivel / Math.max(bloco.length, 1))

    const colStyles: Record<number, object> = {
      0: { halign: 'left', cellWidth: LABEL_W, fontStyle: 'bold' },
    }
    for (let i = 1; i <= bloco.length; i++) colStyles[i] = { cellWidth: dayW }
    if (ultimo) colStyles[headers.length - 1] = { cellWidth: TOTAL_W, fontStyle: 'bold' }

    const tableWidth = LABEL_W + bloco.length * dayW + (ultimo ? TOTAL_W : 0)
    const base = baseTableStyles(7)

    autoTable(doc, {
      ...base,
      startY: r.y,
      tableWidth,
      head: [headers],
      body: bodyRows,
      margin: { left: MARGIN_X, right: MARGIN_X, bottom: 14 },
      styles: { ...base.styles, halign: 'right' },
      headStyles: { ...base.headStyles },
      columnStyles: colStyles,
      didParseCell: (hook) => {
        if (hook.section === 'head') {
          if (hook.column.index === 0) hook.cell.styles.halign = 'left'
          return
        }
        if (hook.section !== 'body') return
        const row = rowData[hook.row.index]
        if (!row) return
        const isLabel = hook.column.index === 0

        if (row.type === 'group-entrada' || row.type === 'group-saida') {
          const tom = row.type === 'group-entrada' ? POSITIVE : NEGATIVE
          hook.cell.styles.textColor = isLabel ? INK : tom
          hook.cell.styles.fontStyle = 'bold'
          hook.cell.styles.lineWidth = { top: 0.3, right: 0, bottom: 0.1, left: 0 }
          if (isLabel) {
            // O rótulo já vem com "— " do buildRowData; a barra de acento é
            // reforço visual, nunca o único portador do significado.
            hook.cell.text = [String(hook.cell.raw).replace(/^—\s*/, '').toUpperCase()]
            hook.cell.styles.cellPadding = { top: 1.6, bottom: 1.6, left: 4, right: 2 }
          }
        } else if (row.type === 'sub') {
          if (isLabel) {
            // columnStyles[0] deixa a coluna inteira em negrito; a sub-obra é
            // subordinada ao grupo, então volta a peso normal e ganha recuo.
            hook.cell.styles.fontStyle = 'normal'
            hook.cell.styles.textColor = MUTED
            hook.cell.styles.cellPadding = { top: 1.6, bottom: 1.6, left: 7, right: 2 }
          }
        } else if (row.type === 'saldo') {
          hook.cell.styles.fillColor = ZEBRA
          hook.cell.styles.fontStyle = 'bold'
          hook.cell.styles.lineWidth = { top: 0.3, right: 0, bottom: 0.1, left: 0 }
          if (!isLabel) {
            const dia = diasData[inicio + hook.column.index - 1]
            if (dia) hook.cell.styles.textColor = toneDoValor(dia.acumulado)
          }
        } else if (row.type === 'aporte') {
          hook.cell.styles.fontStyle = 'bold'
          if (!isLabel) hook.cell.styles.textColor = NEGATIVE
        }
      },
      willDrawCell: (hook) => {
        if (hook.section !== 'body' || hook.column.index !== 0) return
        const row = rowData[hook.row.index]
        if (!row || (row.type !== 'group-entrada' && row.type !== 'group-saida')) return
        const tom = row.type === 'group-entrada' ? POSITIVE : NEGATIVE
        doc.setFillColor(...tom)
        doc.rect(hook.cell.x, hook.cell.y + 0.6, 1.2, hook.cell.height - 1.2, 'F')
      },
    })
  })

  drawFooter(r, TITULO_PIVOT)
  saveReport(doc, 'fluxo_caixa', empresaLabel)
}

// ─── XLSX ───────────────────────────────────────────────────────────────────

export function exportPivotXLSX(data: PivotExportData): void {
  const { diasData, empresaLabel, periodoLabel, saldoBancario } = data

  const headers = buildHeaders(diasData)
  const rowData = buildRowData(data)

  const aoa: (string | number | null)[][] = [
    [`FLUXO DE CAIXA DIÁRIO: ${empresaLabel}`],
    [`PERÍODO: ${periodoLabel}`],
    [`SALDO BANCÁRIO: ${saldoBancario !== null ? formatCurrency(saldoBancario) : 'N/D'}`],
    [],
    headers,
    ...rowData.map(r => [r.label, ...r.cells]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Column widths
  ws['!cols'] = [
    { wch: 28 },                                           // label
    ...diasData.map(() => ({ wch: 16 })),                  // dates
    { wch: 18 },                                           // Total Geral
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Fluxo de Caixa')
  XLSX.writeFile(wb, `${buildReportFilename('fluxo_caixa', empresaLabel)}.xlsx`)
}

// ─── Extrato Bancário Export ─────────────────────────────────────────────────

export interface ExtratoRowExport {
  data: string
  tipo: string
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

const TITULO_EXTRATO = 'Extrato de Movimentação Financeira'

export function exportExtratoPDF(rows: ExtratoRowExport[], empresaLabel: string, periodoLabel: string): void {
  const r = createReport({ orientation: 'portrait', title: TITULO_EXTRATO, scope: empresaLabel })
  const { doc } = r

  const totalEntrada = rows.reduce((s, x) => s + (x.entrada ?? 0), 0)
  const totalSaida = rows.reduce((s, x) => s + (x.saida ?? 0), 0)
  const saldoFinal = rows.length > 0 ? rows[rows.length - 1].saldo : 0

  drawMetaRow(r, [
    { label: 'Período', value: periodoLabel || '—' },
    { label: 'Lançamentos', value: String(rows.length) },
    { label: 'Gerado em', value: nowStamp() },
  ])

  drawKpiRow(r, [
    { label: 'Entradas', value: formatCurrency(totalEntrada), tone: POSITIVE },
    { label: 'Saídas', value: formatCurrency(totalSaida), tone: NEGATIVE },
    { label: 'Saldo final', value: formatCurrency(saldoFinal), tone: toneDoValor(saldoFinal) },
  ])

  const headers = ['Data', 'Tipo', 'Descrição', 'Obra', 'Empresa', 'Entrada', 'Saída', 'Saldo']
  const bodyRows = [
    ...rows.map((x) => [
      x.data,
      x.tipo,
      x.descricao,
      x.obra,
      x.empresa,
      x.entrada !== null ? fmt(x.entrada) : '',
      x.saida !== null ? fmt(x.saida) : '',
      fmt(x.saldo),
    ]),
    ['', '', '', '', 'Total', fmt(totalEntrada), fmt(totalSaida), ''],
  ]

  // Somam exatamente os 194mm úteis do A4 retrato. "Saldo Inicial" e os nomes
  // de empresa precisam caber sem quebrar; só Descrição pode fluir em 2 linhas.
  const colStyles: Record<number, object> = {
    0: { cellWidth: 16, halign: 'left' },
    1: { cellWidth: 19, halign: 'left' },
    2: { cellWidth: 50, halign: 'left' },
    3: { cellWidth: 14, halign: 'left' },
    4: { cellWidth: 24, halign: 'left' },
    5: { cellWidth: 22 },
    6: { cellWidth: 22 },
    7: { cellWidth: 27 },
  }

  const base = baseTableStyles(7)

  autoTable(doc, {
    ...base,
    startY: r.y,
    head: [headers],
    body: bodyRows,
    margin: { left: MARGIN_X, right: MARGIN_X, top: 20, bottom: 14 },
    columnStyles: colStyles,
    didParseCell: (hook) => {
      if (hook.section === 'head') {
        if (hook.column.index <= 4) hook.cell.styles.halign = 'left'
        return
      }
      if (hook.section !== 'body') return

      const isTotal = hook.row.index === rows.length
      if (isTotal) {
        hook.cell.styles.fillColor = ZEBRA
        hook.cell.styles.fontStyle = 'bold'
        hook.cell.styles.lineWidth = { top: 0.3, right: 0, bottom: 0.1, left: 0 }
        if (hook.column.index === 5) hook.cell.styles.textColor = POSITIVE
        else if (hook.column.index === 6) hook.cell.styles.textColor = NEGATIVE
        return
      }

      const row = rows[hook.row.index]
      if (!row) return

      if (row.tipo === 'Saldo Inicial') {
        hook.cell.styles.fillColor = ZEBRA
        hook.cell.styles.fontStyle = 'bold'
      } else if (row.tipo === 'Entrada' && hook.column.index === 5) {
        hook.cell.styles.textColor = POSITIVE
        hook.cell.styles.fontStyle = 'bold'
      } else if (row.tipo === 'Saída' && hook.column.index === 6) {
        hook.cell.styles.textColor = NEGATIVE
        hook.cell.styles.fontStyle = 'bold'
      }

      if (hook.column.index === 7) {
        hook.cell.styles.fontStyle = 'bold'
        hook.cell.styles.textColor = toneDoValor(row.saldo)
      }
    },
    didDrawPage: (hook) => {
      if (hook.pageNumber > 1) drawCompactBand(r, TITULO_EXTRATO, empresaLabel)
    },
  })

  drawFooter(r, TITULO_EXTRATO)
  saveReport(doc, 'extrato_movimentacao_financeira', empresaLabel)
}

export function exportExtratoXLSX(rows: ExtratoRowExport[], empresaLabel: string, periodoLabel: string): void {
  const headers = ['Data', 'Tipo', 'Descrição', 'Obra', 'Empresa', 'Entrada', 'Saída', 'Saldo', 'Origem', 'Banco', 'Conta']
  const totalEntrada = rows.reduce((s, r) => s + (r.entrada ?? 0), 0)
  const totalSaida = rows.reduce((s, r) => s + (r.saida ?? 0), 0)

  const aoa: (string | number | null)[][] = [
    [`EXTRATO DE MOVIMENTAÇÃO FINANCEIRA: ${empresaLabel}`],
    [`PERÍODO: ${periodoLabel}`],
    [],
    headers,
    ...rows.map(r => [
      r.data,
      r.tipo,
      r.descricao,
      r.obra,
      r.empresa,
      r.entrada,
      r.saida,
      r.saldo,
      r.origem,
      r.banco,
      r.conta,
    ]),
    ['', '', '', '', 'Total', totalEntrada, totalSaida, '', '', '', ''],
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  ws['!cols'] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 32 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Extrato Movimentação Financeira')
  XLSX.writeFile(wb, `${buildReportFilename('extrato_movimentacao_financeira', empresaLabel)}.xlsx`)
}
