import { useState, useEffect } from 'react'

export type Theme = 'light' | 'dark' | 'auto'

function getSavedTheme(): Theme {
  return (localStorage.getItem('pooly_theme') as Theme) ?? 'dark'
}

function getEffectiveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme)

  useEffect(() => {
    const effective = getEffectiveTheme(theme)
    document.documentElement.setAttribute('data-theme', effective)
    localStorage.setItem('pooly_theme', theme)
  }, [theme])

  // Listen for system changes while in auto mode
  useEffect(() => {
    if (theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  return { theme, setTheme }
}
