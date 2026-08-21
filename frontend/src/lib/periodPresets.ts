export type Preset = 'hoje' | '7dias' | 'quinzenal' | 'mes' | 'bimestre' | 'trimestre' | 'semestre' | 'ano'

export const PERIOD_PRESETS: { key: Preset; label: string }[] = [
  { key: 'hoje',      label: 'Hoje'      },
  { key: '7dias',     label: '7 Dias'    },
  { key: 'quinzenal', label: 'Quinzenal' },
  { key: 'mes',       label: 'Este Mês'  },
  { key: 'bimestre',  label: 'Bimestre'  },
  { key: 'trimestre', label: 'Trimestre' },
  { key: 'semestre',  label: 'Semestre'  },
  { key: 'ano',       label: 'Este Ano'  },
]

export function getPresetRange(preset: Preset): [string, string] {
  const today = new Date()
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }

  switch (preset) {
    case 'hoje': { const d = fmt(today); return [d, d] }
    case '7dias': return [fmt(today), fmt(addDays(today, 6))]
    case 'quinzenal': return [fmt(today), fmt(addDays(today, 14))]
    case 'mes': return [
      fmt(new Date(today.getFullYear(), today.getMonth(), 1)),
      fmt(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    ]
    case 'bimestre': { const b = Math.floor(today.getMonth() / 2); return [
      fmt(new Date(today.getFullYear(), b * 2, 1)),
      fmt(new Date(today.getFullYear(), b * 2 + 2, 0)),
    ]}
    case 'trimestre': { const q = Math.floor(today.getMonth() / 3); return [
      fmt(new Date(today.getFullYear(), q * 3, 1)),
      fmt(new Date(today.getFullYear(), q * 3 + 3, 0)),
    ]}
    case 'semestre': { const s = today.getMonth() < 6 ? 0 : 1; return [
      fmt(new Date(today.getFullYear(), s * 6, 1)),
      fmt(new Date(today.getFullYear(), s * 6 + 6, 0)),
    ]}
    case 'ano': return [
      fmt(new Date(today.getFullYear(), 0, 1)),
      fmt(new Date(today.getFullYear(), 11, 31)),
    ]
  }
}

/** Preset cujo intervalo corresponde exatamente às datas informadas, se houver. */
export function findActivePreset(startDate: string, endDate: string): Preset | null {
  for (const { key } of PERIOD_PRESETS) {
    const [s, e] = getPresetRange(key)
    if (s === startDate && e === endDate) return key
  }
  return null
}
