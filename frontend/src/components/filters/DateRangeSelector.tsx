import { useMemo } from 'react'
import { PERIOD_PRESETS, getPresetRange, findActivePreset, type Preset } from '@/lib/periodPresets'

interface DateRangeSelectorProps {
  startDate: string
  endDate: string
  onStartDateChange: (val: string) => void
  onEndDateChange: (val: string) => void
  /** Sem borda inferior nem rótulo "Período" — para uso dentro de um popover que já os fornece. */
  bare?: boolean
}

export function DateRangeSelector({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  bare,
}: DateRangeSelectorProps) {
  const handlePreset = (preset: Preset) => {
    const [s, e] = getPresetRange(preset)
    onStartDateChange(s)
    onEndDateChange(e)
  }

  const activePreset = useMemo<Preset | null>(
    () => findActivePreset(startDate, endDate),
    [startDate, endDate]
  )

  return (
    <div className={bare ? 'flex flex-col gap-3' : 'flex flex-col gap-3 border-b border-line pb-5'}>
      {!bare && <span className="section-label">Período</span>}

      <div className="grid grid-cols-2 gap-1">
        {PERIOD_PRESETS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => handlePreset(key)}
            className={`h-8 rounded-md border px-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              activePreset === key
                ? 'border-dark bg-dark text-white'
                : 'border-line bg-white text-dark hover:border-brand hover:bg-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground font-black uppercase">De</span>
          <input
            type="date"
            style={{ colorScheme: 'light' }}
            className="h-9 w-full rounded-md border border-line bg-white px-2 text-xs font-medium text-dark focus:outline-none focus:ring-2 focus:ring-brand/25"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground font-black uppercase">Até</span>
          <input
            type="date"
            style={{ colorScheme: 'light' }}
            className="h-9 w-full rounded-md border border-line bg-white px-2 text-xs font-medium text-dark focus:outline-none focus:ring-2 focus:ring-brand/25"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
