export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value)
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toFixed(0)}K`
  return formatCurrency(value)
}

export function formatDate(ddmmyyyy: string): string {
  return ddmmyyyy
}

export function parseDate(ddmmyyyy: string): Date | null {
  if (!ddmmyyyy) return null
  const [d, m, y] = ddmmyyyy.split('/')
  return new Date(`${y}-${m}-${d}T00:00:00`)
}

export function formatDateTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100)
}

export function compareDates(a: string, b: string): number {
  const [da, ma, ya] = a.split('/').map(Number)
  const [db, mb, yb] = b.split('/').map(Number)
  return ya * 10000 + ma * 100 + da - (yb * 10000 + mb * 100 + db)
}

export function formatBRLThousands(raw: string): string {
  let value = raw.replace(/[^\d,]/g, '')
  const firstComma = value.indexOf(',')
  if (firstComma !== -1) {
    value = value.slice(0, firstComma + 1) + value.slice(firstComma + 1).replace(/,/g, '')
  }
  const [intPart, decPart] = value.split(',')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return decPart !== undefined ? `${grouped},${decPart.slice(0, 2)}` : grouped
}

export function parseBRLInput(raw: string): number {
  const cleaned = raw.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

export function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${v}"`).join(';'))
    .join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Intervalo ISO (YYYY-MM-DD) formatado como "DD/MM/YYYY – DD/MM/YYYY". */
export function formatRangeLabel(start: string, end: string): string {
  if (!start || !end) return 'Período completo'
  const fmt = (value: string) => value.split('-').reverse().join('/')
  return `${fmt(start)} – ${fmt(end)}`
}
