import { Sun, Moon } from 'lucide-react'
import type { Theme } from '../hooks/useTheme'
import type { Locale } from '../i18n/translations'

/** Mirrors the anti-flash script in index.html — what the page already painted. */
function getIsDark(theme: Theme): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Shared by the desktop sidebar footer and the mobile settings sheet, so the
 * control (and its a11y role) is identical wherever it lives. */
export function ThemeSwitch({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const isDark = getIsDark(theme)
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark')
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '6px 12px',
    }}>
      <Sun size={14} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--text-muted)', opacity: isDark ? 0.4 : 1, transition: 'opacity 0.2s' }} />

      <div
        onClick={toggleTheme}
        role="switch"
        aria-checked={isDark}
        aria-label="Theme"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTheme() } }}
        style={{
          width: 40,
          height: 22,
          borderRadius: 100,
          background: isDark ? 'var(--accent-dim)' : 'var(--bg-surface-2)',
          border: '1px solid var(--border)',
          position: 'relative',
          cursor: 'pointer',
          transition: 'background 0.3s, border-color 0.3s',
          flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute',
          top: 3,
          left: 3,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'var(--accent)',
          transform: isDark ? 'translateX(18px)' : 'translateX(0)',
          transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }} />
      </div>

      <Moon size={14} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--text-muted)', opacity: isDark ? 1 : 0.4, transition: 'opacity 0.2s' }} />
    </div>
  )
}

export function LocaleSwitch({ locale, setLocale }: { locale: Locale; setLocale: (l: Locale) => void }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 12px',
    }}>
      {(['fr', 'en'] as Locale[]).map(l => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          style={{
            flex: 1,
            padding: '4px 0',
            borderRadius: 4,
            border: 'none',
            background: locale === l ? 'var(--accent-dim)' : 'transparent',
            color: locale === l ? 'var(--accent)' : 'var(--text-muted)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: "'IBM Plex Mono', monospace",
            transition: 'all 0.15s',
            letterSpacing: '0.05em',
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
