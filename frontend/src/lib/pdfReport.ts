import { jsPDF } from 'jspdf'
import type { UserOptions } from 'jspdf-autotable'

/**
 * Kit de relatório em PDF — cabeçalho com marca, metadados, cartões de
 * indicadores, estilos de tabela e rodapé paginado, compartilhados por todos
 * os exports do sistema.
 *
 * A paleta vem do DESIGN.md; antes cada export carregava a sua (três vermelhos
 * e dois cinzas de cabeçalho diferentes conviviam no mesmo produto).
 */

export type RGB = [number, number, number]

export const INK: RGB = [28, 46, 56]         // #1C2E38 — grafite, texto e faixa
export const AMBER: RGB = [217, 119, 6]      // #D97706 — sinal, escopo, acentos
export const POSITIVE: RGB = [8, 127, 104]   // #087F68 — entradas, saldo positivo
export const NEGATIVE: RGB = [180, 35, 24]   // #B42318 — saídas, saldo negativo
export const LINE: RGB = [213, 224, 228]     // #D5E0E4 — hairlines
export const MUTED: RGB = [107, 124, 136]    // rótulos e metadados secundários
export const WHITE: RGB = [255, 255, 255]
export const ZEBRA: RGB = [247, 250, 251]    // faixa alternada muito leve

const BAND_H = 20        // altura da faixa de cabeçalho
export const MARGIN_X = 8

export interface ReportHandle {
  doc: jsPDF
  /** Cursor vertical logo abaixo do que já foi desenhado. */
  y: number
  pageW: number
  pageH: number
  contentW: number
}

const SUBSTITUICOES: [RegExp, string][] = [
  [/[\u2018\u2019\u201B]/g, "'"],
  [/[\u201C\u201D]/g, '"'],
  [/[\u2010-\u2015]/g, '-'],
  [/[\u2192\u21D2]/g, 'a'],
  [/\u2022/g, '·'],
  [/\u2026/g, '...'],
  [/\u00A0/g, ' '],
]

/**
 * As fontes embutidas do jsPDF são WinAnsi: um caractere fora dessa tabela não
 * só deixa de aparecer como corrompe o espaçamento do resto da linha. Aplicado
 * a todo texto que o kit desenha, porque parte dele vem digitado pelo usuário
 * (nome e descrição de grupo, rótulos de escopo).
 */
export function winAnsi(text: string): string {
  let out = text
  for (const [de, para] of SUBSTITUICOES) out = out.replace(de, para)
  // eslint-disable-next-line no-control-regex
  return out.replace(/[^\x00-\xFF]/g, '')
}

/** Data/hora de geração no formato dd/mm/aaaa hh:mm. */
export function nowStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Marca da Dashfinance desenhada em vetor (quadrado grafite com uma polilinha
 * âmbar), espelhando public/favicon.svg. Vetorizar evita embutir base64 no
 * bundle — não existe asset de logo no repositório.
 */
export function drawBrandMark(doc: jsPDF, x: number, y: number, size: number): void {
  doc.setFillColor(...WHITE)
  doc.roundedRect(x, y, size, size, size * 0.2, size * 0.2, 'F')

  const p = (fx: number, fy: number): [number, number] => [x + size * fx, y + size * fy]
  doc.setDrawColor(...AMBER)
  doc.setLineWidth(size * 0.10)
  doc.setLineCap('round')
  doc.setLineJoin('round')
  const pts: [number, number][] = [p(0.2, 0.7), p(0.4, 0.5), p(0.55, 0.65), p(0.8, 0.3)]
  for (let i = 1; i < pts.length; i++) {
    doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
  }
  doc.setFillColor(...AMBER)
  doc.circle(...p(0.8, 0.3), size * 0.07, 'F')
  doc.setLineCap('butt')
}

export interface CreateReportOptions {
  orientation: 'portrait' | 'landscape'
  /** Título do relatório, à direita da faixa. */
  title: string
  /** Escopo (empresa, grupo…), em âmbar sob o título. */
  scope?: string
}

/** Cria o documento e desenha a faixa de cabeçalho. */
export function createReport({ orientation, title, scope }: CreateReportOptions): ReportHandle {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const pageW = orientation === 'landscape' ? 297 : 210
  const pageH = orientation === 'landscape' ? 210 : 297

  doc.setFillColor(...INK)
  doc.rect(0, 0, pageW, BAND_H, 'F')

  drawBrandMark(doc, MARGIN_X, 5, 10)

  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('DASHFINANCE', MARGIN_X + 13, 10.5, { charSpace: 0.35 })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(150, 168, 178)
  doc.text('SALA DE CONTROLE', MARGIN_X + 13, 14.5, { charSpace: 0.3 })

  const right = pageW - MARGIN_X
  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(winAnsi(title.toUpperCase()), right, scope ? 10.5 : 12.5, { align: 'right' })
  if (scope) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...AMBER)
    doc.text(winAnsi(scope), right, 15.5, { align: 'right' })
  }

  return { doc, y: BAND_H + 8, pageW, pageH, contentW: pageW - MARGIN_X * 2 }
}

/**
 * Faixa compacta para páginas de continuação — mantém o leitor orientado sem
 * repetir o cabeçalho inteiro. Devolve o y logo abaixo dela.
 */
export function drawCompactBand(r: ReportHandle, title: string, scope?: string): number {
  const { doc, pageW } = r
  const h = 12
  doc.setFillColor(...INK)
  doc.rect(0, 0, pageW, h, 'F')

  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text(winAnsi(title.toUpperCase()), MARGIN_X, 7.8)

  if (scope) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...AMBER)
    doc.text(winAnsi(scope), pageW - MARGIN_X, 7.8, { align: 'right' })
  }

  return h + 6
}

export interface MetaItem {
  label: string
  value: string
}

/** Linha de metadados em colunas (PERÍODO / SALDO / GERADO EM), com régua abaixo. */
export function drawMetaRow(r: ReportHandle, items: MetaItem[]): number {
  const { doc, pageW } = r
  const colW = r.contentW / items.length
  let y = r.y

  items.forEach((item, i) => {
    const x = MARGIN_X + colW * i
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...MUTED)
    doc.text(winAnsi(item.label.toUpperCase()), x, y, { charSpace: 0.3 })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    doc.text(winAnsi(item.value), x, y + 5)
  })

  y += 9
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.2)
  doc.line(MARGIN_X, y, pageW - MARGIN_X, y)

  r.y = y + 7
  return r.y
}

export interface KpiCard {
  label: string
  value: string
  tone?: RGB
}

/** Faixa de cartões de indicadores. */
export function drawKpiRow(r: ReportHandle, cards: KpiCard[]): number {
  const { doc } = r
  const gap = 4
  const cardW = (r.contentW - gap * (cards.length - 1)) / cards.length
  const cardH = 17
  const y = r.y

  cards.forEach((card, i) => {
    const x = MARGIN_X + (cardW + gap) * i
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.2)
    doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'S')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...MUTED)
    doc.text(winAnsi(card.label.toUpperCase()), x + 4, y + 5.5, { charSpace: 0.3 })

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...(card.tone ?? INK))
    doc.text(winAnsi(card.value), x + 4, y + 13)
  })

  r.y = y + cardH + 8
  return r.y
}

/**
 * Estilos base da tabela: sem grade cheia, só hairline inferior; cabeçalho
 * na faixa grafite. Espalhe por cima o que for específico do relatório.
 */
export function baseTableStyles(fontSize = 7): Pick<UserOptions, 'theme' | 'styles' | 'headStyles'> {
  return {
    theme: 'plain',
    styles: {
      fontSize,
      textColor: INK,
      cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
      halign: 'right',
      overflow: 'linebreak',
      lineColor: LINE,
      lineWidth: { top: 0, right: 0, bottom: 0.1, left: 0 },
    },
    headStyles: {
      fillColor: INK,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize,
      halign: 'center',
      lineWidth: 0,
    },
  }
}

/** Rodapé com origem e paginação, aplicado a todas as páginas já criadas. */
export function drawFooter(r: ReportHandle, label: string): void {
  const { doc, pageW, pageH } = r
  const total = doc.getNumberOfPages()

  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.2)
    doc.line(MARGIN_X, pageH - 9, pageW - MARGIN_X, pageH - 9)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text(winAnsi(`DashFinance · ${label}`), MARGIN_X, pageH - 5)
    doc.text(`Página ${i} de ${total}`, pageW - MARGIN_X, pageH - 5, { align: 'right' })
  }
}

/** Carimbo de data/hora seguro para nome de arquivo: DD-MM-AAAA_HHHMM. */
function fileStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}_${p(d.getHours())}H${p(d.getMinutes())}`
}

/**
 * Monta o nome final de um relatório: junta as partes, sanitiza, coloca tudo
 * em maiúsculas e acrescenta a data/hora de geração no final.
 */
export function buildReportFilename(...parts: string[]): string {
  const base = parts
    .filter(Boolean)
    .map((p) => p.replace(/[^a-zA-Z0-9]/g, '_'))
    .join('_')
  return `${base.toUpperCase()}_${fileStamp()}`
}

/** Salva com a convenção de nome já usada pelo sistema. */
export function saveReport(doc: jsPDF, slug: string, scope: string): void {
  doc.save(`${buildReportFilename(slug, scope)}.pdf`)
}
