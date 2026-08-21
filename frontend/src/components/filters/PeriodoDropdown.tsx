import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { DateRangeSelector } from './DateRangeSelector'
import { formatRangeLabel } from '@/lib/formatters'
import { PERIOD_PRESETS, findActivePreset } from '@/lib/periodPresets'
import { cn } from '@/lib/utils'

interface PeriodoDropdownProps {
  startDate: string
  endDate: string
  onStartDateChange: (val: string) => void
  onEndDateChange: (val: string) => void
}

export function PeriodoDropdown({ startDate, endDate, onStartDateChange, onEndDateChange }: PeriodoDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Um preset conhecido ("Este Ano") lê melhor e é bem mais estreito que o intervalo por extenso.
  const preset = findActivePreset(startDate, endDate)
  const displayText = preset
    ? PERIOD_PRESETS.find((p) => p.key === preset)!.label
    : formatRangeLabel(startDate, endDate)

  return (
    <div className="shrink-0" ref={ref}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={cn(
            'flex h-9 w-auto items-center gap-1.5 rounded-md border bg-white px-3 text-xs font-medium text-dark transition-colors hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
            open ? 'border-brand' : 'border-line'
          )}
        >
          <span className="shrink-0 text-muted-foreground">Período</span>
          <span className="truncate font-semibold text-dark" title={formatRangeLabel(startDate, endDate)}>{displayText}</span>
          <ChevronDown className={cn('ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="absolute z-50 mt-1 w-[300px] rounded-lg border border-line bg-white p-3 shadow-panel">
            <DateRangeSelector
              bare
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={onStartDateChange}
              onEndDateChange={onEndDateChange}
            />
          </div>
        )}
      </div>
    </div>
  )
}
