import * as React from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'outline' | 'destructive'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-50',
        {
          'bg-dark text-white hover:bg-brand hover:text-dark': variant === 'default',
          'text-muted-foreground hover:bg-muted hover:text-foreground': variant === 'ghost',
          'border border-line bg-transparent text-dark hover:border-brand hover:bg-bgBase': variant === 'outline',
          'bg-destructive text-white hover:bg-red-700': variant === 'destructive',
        },
        {
          'h-10 px-4 py-2': size === 'default',
          'h-8 px-3': size === 'sm',
          'h-11 px-8': size === 'lg',
          'h-9 w-9': size === 'icon',
        },
        className
      )}
      {...props}
    />
  )
)
Button.displayName = 'Button'

export { Button }
