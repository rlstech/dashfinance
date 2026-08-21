/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: 'hsl(var(--brand))',
        dark: 'hsl(var(--foreground))',
        surface: 'hsl(var(--card))',
        bgBase: 'hsl(var(--background))',
        grid: 'hsl(var(--border))',
        positive: 'hsl(var(--positive))',
        negative: 'hsl(var(--negative))',
        info: 'hsl(var(--info))',
        sidebar: 'hsl(var(--sidebar))',
        sidebarMuted: 'hsl(var(--sidebar-muted))',
        line: 'hsl(var(--border))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        panel: '0 10px 24px rgba(28, 46, 56, 0.06)',
        dropdown: '0 16px 32px rgba(28, 46, 56, 0.14)',
      },
    },
  },
  plugins: [],
}
