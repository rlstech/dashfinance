import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MultiSelectProps {
  label: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  allLabel?: string
}

export function MultiSelect({ label, options, selected, onChange, allLabel = 'Todos' }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val])
  }

  const displayText = selected.length === 0 ? allLabel : selected.length === 1 ? selected[0] : `${selected.length} selecionados`

  return (
    <div className="flex flex-col gap-1.5" ref={ref}>
      <span className="section-label">{label}</span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border bg-white px-3 text-xs font-medium text-dark transition-colors hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
            open ? 'border-brand' : 'border-line'
          )}
        >
          <span className="truncate">{displayText}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 ml-2 text-muted-foreground transition-transform duration-200 shrink-0', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="absolute z-50 mt-1 max-h-[280px] w-full min-w-[200px] overflow-auto rounded-lg border border-line bg-white shadow-panel">
            <div className="p-1">
              <button
                type="button"
                onClick={() => { onChange([]); setOpen(false) }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-xs font-medium transition-colors hover:bg-bgBase',
                  selected.length === 0 && 'text-brand'
                )}
              >
                <div className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                  selected.length === 0 ? 'border-brand bg-brand' : 'border-line'
                )}>
                  {selected.length === 0 && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
                {allLabel}
              </button>

              {options.length > 0 && <div className="h-px bg-grid mx-1 my-1" />}

              {options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-xs font-medium transition-colors hover:bg-bgBase"
                >
                  <div className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    selected.includes(opt) ? 'border-brand bg-brand' : 'border-line'
                  )}>
                    {selected.includes(opt) && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  <span className="text-left truncate">{opt}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
