import { useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'dashfinance-theme'

function getStoredPreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

function applyTheme(preference: ThemePreference) {
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('theme-dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredPreference())

  useEffect(() => {
    applyTheme(preference)
    window.localStorage.setItem(STORAGE_KEY, preference)

    if (preference !== 'system') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [preference])

  return { preference, setPreference }
}
