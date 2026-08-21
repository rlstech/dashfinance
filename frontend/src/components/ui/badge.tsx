import { cn } from '@/lib/utils'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'destructive' | 'warning' | 'outline'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide',
        {
          'bg-dark text-white': variant === 'default',
          'bg-emerald-600 text-white': variant === 'success',
          'bg-red-600 text-white': variant === 'destructive',
          'bg-brand text-dark': variant === 'warning',
          'border border-line bg-white text-dark': variant === 'outline',
        },
        className
      )}
      {...props}
    />
  )
}
