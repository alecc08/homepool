import { useState, useEffect } from 'react'
import { useT } from '../context/LocaleContext'

const DISMISS_KEY = 'pooly_install_dismissed'
const DISMISS_TTL = 7 * 24 * 60 * 60 * 1000 // 7 jours

function isDismissedRecently(): boolean {
  const ts = localStorage.getItem(DISMISS_KEY)
  if (!ts) return false
  return Date.now() - parseInt(ts, 10) < DISMISS_TTL
}

export default function InstallBanner() {
  const { t } = useT()
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      if (!isDismissedRecently()) {
        setPrompt(e as BeforeInstallPromptEvent)
        setVisible(true)
      }
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!visible || !prompt) return null

  const handleInstall = async () => {
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setVisible(false)
  }

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setVisible(false)
  }

  return (
    <div className="install-banner">
      <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>💧</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
          {t('install_banner_title')}
        </div>
        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, opacity: 0.65, marginTop: 2 }}>
          {t('install_banner_subtitle')}
        </div>
      </div>
      <button className="install-banner-btn" onClick={handleInstall}>
        {t('install_banner_button')}
      </button>
      <button
        onClick={handleDismiss}
        aria-label={t('common_close')}
        style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)',
          fontSize: 18, cursor: 'pointer', padding: '4px 2px', lineHeight: 1, flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}

// Extension of the BeforeInstallPromptEvent type (not included in the standard lib.dom.d.ts)
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
