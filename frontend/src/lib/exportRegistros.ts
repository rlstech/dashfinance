import autoTable from 'jspdf-autotable'
import * as XLSX from '@e965/xlsx'
import { formatCurrency } from './formatters'
import {
  createReport, drawMetaRow, drawKpiRow, drawFooter, drawCompactBand,
  baseTableStyles, nowStamp, saveReport,
  INK, WHITE, MARGIN_X, type RGB,
} from './pdfReport'

/**
 * Export tabular de registros (Receitas, Despesas). Antes esse código vivia
 * duplicado nas duas páginas; aqui fica parametrizado pelas colunas.
 */

export interface ColunaRegistro {
  header: string
  /** Largura em mm; a soma deve fechar os 194mm úteis do A4 retrato. */
  width: number
  align?: 'left' | 'center' | 'right'
}

export interface RegistrosExport {
  titulo: string
  slug: string
  empresaLabel: string
  periodoLabel: string
  colunas: ColunaRegistro[]
  /** Já formatadas para exibição. */
  linhas: string[][]
  total: number
  /** Cartões extras além de "Total" e "Registros". */
  kpisExtras?: { label: string; value: string; tone?: RGB }[]
}

export function exportRegistrosPDF(d: RegistrosExport): void {
  const r = createReport({ orientation: 'portrait', title: d.titulo, scope: d.empresaLabel })
  const { doc } = r

  drawMetaRow(r, [
    { label: 'Período', value: d.periodoLabel },
    { label: 'Registros', value: String(d.linhas.length) },
    { label: 'Gerado em', value: nowStamp() },
  ])

  drawKpiRow(r, [
    { label: 'Total do período', value: formatCurrency(d.total) },
    ...(d.kpisExtras ?? []),
  ])

  const colStyles: Record<number, object> = {}
  d.colunas.forEach((c, i) => {
    colStyles[i] = { cellWidth: c.width, halign: c.align ?? 'left' }
  })

  const rodape = d.colunas.map((_, i) =>
    i === d.colunas.length - 2 ? 'TOTAL' : i === d.colunas.length - 1 ? formatCurrency(d.total) : ''
  )

  const base = baseTableStyles(7)

  autoTable(doc, {
    ...base,
    startY: r.y,
    head: [d.colunas.map((c) => c.header)],
    body: d.linhas,
    foot: [rodape],
    showFoot: 'lastPage',
    tableWidth: d.colunas.reduce((s, c) => s + c.width, 0),
    margin: { left: MARGIN_X, right: MARGIN_X, top: 20, bottom: 14 },
    footStyles: {
      fillColor: INK,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 7,
      lineWidth: 0,
    },
    columnStyles: colStyles,
    didParseCell: (hook) => {
      if (hook.section === 'head') {
        hook.cell.styles.halign = d.colunas[hook.column.index]?.align ?? 'left'
      }
    },
    didDrawPage: (hook) => {
      if (hook.pageNumber > 1) drawCompactBand(r, d.titulo, d.empresaLabel)
    },
  })

  drawFooter(r, d.titulo)
  saveReport(doc, d.slug, d.empresaLabel)
}

export interface RegistrosXLSX {
  titulo: string
  slug: string
  sheetName: string
  empresaLabel: string
  periodoLabel: string
  headers: string[]
  /** Valores crus — números permanecem números para o Excel somar. */
  linhas: (string | number | null)[][]
  total: number
  larguras: number[]
}

export function exportRegistrosXLSX(d: RegistrosXLSX): void {
  const aoa: (string | number | null)[][] = [
    [d.titulo.toUpperCase()],
    [`Empresa: ${d.empresaLabel}`],
    [`Período: ${d.periodoLabel}`],
    [`Total: ${formatCurrency(d.total)} (${d.linhas.length} registros)`],
    [],
    d.headers,
    ...d.linhas,
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = d.larguras.map((wch) => ({ wch }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, d.sheetName)
  XLSX.writeFile(wb, `${d.slug}_${d.empresaLabel.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`)
}
