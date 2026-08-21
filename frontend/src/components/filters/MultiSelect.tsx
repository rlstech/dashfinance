import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Largura mínima do popover, usada para decidir se ele abre alinhado à direita. */
const POPOVER_WIDTH = 240

interface MultiSelectProps {
  label: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  allLabel?: string
  /** Rótulo dentro do gatilho e largura automática, para uso na barra de filtros horizontal. */
  inline?: boolean
}

export function MultiSelect({ label, options, selected, onChange, allLabel = 'Todos', inline }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Na barra horizontal o gatilho pode estar perto da borda direita; o `<main>` usa
  // overflow-hidden, então um popover que estoure a viewport seria cortado em vez de rolar.
  const handleTriggerClick = () => {
    if (!open && ref.current) {
      const { left } = ref.current.getBoundingClientRect()
      setAlignRight(left + POPOVER_WIDTH > window.innerWidth - 16)
    }
    setOpen(!open)
  }

  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val])
  }

  // Em modo inline o rótulo já aparece no gatilho, então "Todas as Empresas" vira só "Todas".
  const emptyText = inline ? allLabel.split(' ')[0] : allLabel
  const displayText = selected.length === 0 ? emptyText : selected.length === 1 ? selected[0] : `${selected.length} selecionados`

  return (
    <div className={cn(inline ? 'shrink-0' : 'flex flex-col gap-1.5')} ref={ref}>
      {!inline && <span className="section-label">{label}</span>}
      <div className="relative">
        <button
          type="button"
          onClick={handleTriggerClick}
          className={cn(
            'flex items-center justify-between rounded-md border bg-white px-3 text-xs font-medium text-dark transition-colors hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
            inline ? 'h-9 w-auto max-w-[220px] gap-1.5' : 'h-10 w-full',
            open ? 'border-brand' : 'border-line'
          )}
        >
          {inline && <span className="shrink-0 text-muted-foreground">{label}</span>}
          <span className={cn('truncate', inline && 'font-semibold text-dark')}>{displayText}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 ml-2 text-muted-foreground transition-transform duration-200 shrink-0', open && 'rotate-180')} />
        </button>
        {open && (
          <div className={cn(
            'absolute z-50 mt-1 max-h-[280px] overflow-auto rounded-lg border border-line bg-white shadow-panel',
            inline ? 'min-w-[240px] max-w-[320px]' : 'w-full min-w-[200px]',
            alignRight && 'right-0'
          )}>
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
