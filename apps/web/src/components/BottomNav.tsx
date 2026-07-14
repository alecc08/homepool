import { useT } from '../context/LocaleContext'

type Page = 'log' | 'measurements' | 'history'

type Props = {
  page: Page
  onNavigate: (p: Page) => void
  onAdd: () => void
}

export default function BottomNav({ page, onNavigate, onAdd }: Props) {
  const { t } = useT()
  return (
    <nav className="bottom-nav">
      <button
        className={`bn-item${page === 'log' ? ' active' : ''}`}
        onClick={() => onNavigate('log')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        {t('nav_log')}
      </button>

      <button
        className={`bn-item${page === 'measurements' ? ' active' : ''}`}
        onClick={() => onNavigate('measurements')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        {t('nav_measurements')}
      </button>

      <button
        onClick={onAdd}
        aria-label={t('nav_new_entry_aria')}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '3px',
          flexShrink: 0,
          padding: '6px 10px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <div style={{
          width: '36px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '10px',
          background: 'rgba(56,189,248,0.08)',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="#38bdf8" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </div>
        <span style={{
          fontSize: '9px',
          fontWeight: 600,
          color: '#38bdf8',
          fontFamily: 'Sora, sans-serif',
        }}>{t('nav_new')}</span>
      </button>

      <button
        className={`bn-item${page === 'history' ? ' active' : ''}`}
        onClick={() => onNavigate('history')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        {t('nav_history')}
      </button>
    </nav>
  )
}
