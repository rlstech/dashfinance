import { Monitor, Moon, Sun } from 'lucide-react'
import { type ThemePreference, useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Modo claro', icon: Sun },
  { value: 'dark', label: 'Modo escuro', icon: Moon },
  { value: 'system', label: 'Usar preferência do sistema', icon: Monitor },
]

export function ThemeToggle() {
  const { preference, setPreference } = useTheme()

  return (
    <div className="flex items-center rounded-lg border border-line bg-card p-1" aria-label="Modo de visualização">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={preference === value}
          onClick={() => setPreference(value)}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
            preference === value
              ? 'bg-brand text-white shadow-sm'
              : 'text-muted-foreground hover:bg-bgBase hover:text-dark'
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  )
}
