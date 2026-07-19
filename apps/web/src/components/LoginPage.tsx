import { useState, useMemo } from 'react'
import type { User } from '../types'
import homepoolSidebarLogo from '@/assets/homepool-logo-sidebar.svg'
import { useT } from '../context/LocaleContext'

type AuthView = 'login' | 'register' | 'forgot' | 'reset'

// ── Password strength ─────────────────────────────────────────────────────────

function pwStrength(pw: string): 0 | 1 | 2 {
  if (pw.length < 8) return 0
  return /\d/.test(pw) && /[A-Z]/.test(pw) ? 2 : 1
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function FieldLabel({ children }: { children: string }) {
  return (
    <label style={{
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 10, textTransform: 'uppercase',
      letterSpacing: '0.07em', color: 'var(--text-muted)',
      display: 'block', marginBottom: 4,
    }}>
      {children}
    </label>
  )
}

function FieldError({ children }: { children: string }) {
  return (
    <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--status-danger-text)', margin: '4px 0 0' }}>
      {children}
    </p>
  )
}

function AlertBand({ children, variant = 'error' }: { children: string; variant?: 'error' | 'success' }) {
  return (
    <div style={{
      background: variant === 'error' ? 'var(--status-danger-bg)' : 'var(--status-ok-bg)',
      color: variant === 'error' ? 'var(--status-danger-text)' : 'var(--status-ok-text)',
      borderRadius: 8, padding: '10px 14px',
      fontSize: 12, fontFamily: '"Sora", sans-serif',
    }}>
      {children}
    </div>
  )
}

type FieldInputProps = {
  type?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  required?: boolean
  error?: boolean
  style?: React.CSSProperties
  onFocus?: () => void
  onBlur?: () => void
}

function FieldInput({ error, style, onFocus, onBlur, ...props }: FieldInputProps) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      {...props}
      onFocus={() => { setFocused(true); onFocus?.() }}
      onBlur={() => { setFocused(false); onBlur?.() }}
      style={{
        width: '100%',
        background: focused ? 'var(--bg-surface)' : 'var(--bg-surface-2)',
        border: `1px solid ${error ? 'var(--status-danger-text)' : focused ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 8,
        fontFamily: '"Sora", sans-serif',
        fontSize: 13, color: 'var(--text-primary)',
        padding: '10px 14px',
        outline: 'none',
        boxSizing: 'border-box',
        transition: 'border-color 0.15s, background 0.15s',
        ...style,
      }}
    />
  )
}

function PrimaryBtn({
  children, loading, disabled, type = 'submit',
}: {
  children: string; loading?: boolean; disabled?: boolean; type?: 'submit' | 'button'
}) {
  return (
    <button
      type={type}
      disabled={loading || disabled}
      style={{
        width: '100%', background: 'var(--text-primary)', color: 'var(--bg-surface)',
        border: 'none', borderRadius: 8,
        fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600,
        padding: '11px 0', cursor: loading || disabled ? 'not-allowed' : 'pointer',
        opacity: loading || disabled ? 0.65 : 1, transition: 'opacity 0.15s',
      }}
    >
      {children}
    </button>
  )
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function PwField({
  value, onChange, show, onToggle, error, placeholder = '••••••••',
}: {
  value: string; onChange: (v: string) => void
  show: boolean; onToggle: () => void
  error?: boolean; placeholder?: string
}) {
  return (
    <div style={{ position: 'relative' }}>
      <FieldInput
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        error={error}
        style={{ paddingRight: 42 }}
      />
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center',
        }}
      >
        <EyeIcon open={show} />
      </button>
    </div>
  )
}

function StrengthBar({ password }: { password: string }) {
  const { t } = useT()
  if (!password) return null
  const s = pwStrength(password)
  const colors = ['var(--status-danger-text)', 'var(--status-warn-text)', 'var(--status-ok-text)']
  const labels = [t('auth_password_weak_label'), t('auth_password_medium_label'), t('auth_password_strong_label')]
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= s ? colors[s] : 'var(--border)',
            transition: 'background 0.2s',
          }} />
        ))}
      </div>
      <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 10, color: colors[s], margin: '3px 0 0' }}>
        {labels[s]}
      </p>
    </div>
  )
}

const linkStyle: React.CSSProperties = {
  fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-secondary)',
  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
  textDecoration: 'underline', textUnderlineOffset: 2,
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = { onLogin: (user: User) => void }

export default function LoginPage({ onLogin }: Props) {
  const { t } = useT()

  const initView = (): AuthView => {
    const h = window.location.hash.replace(/^#/, '')
    return h.startsWith('reset-password') ? 'reset' : 'login'
  }
  const [view, setView] = useState<AuthView>(initView)

  const resetToken = useMemo(() => {
    const h = window.location.hash.replace(/^#/, '')
    const q = h.indexOf('?')
    if (q === -1) return ''
    return new URLSearchParams(h.slice(q + 1)).get('token') ?? ''
  }, [])

  // Login
  const [lEmail, setLEmail] = useState('')
  const [lPw, setLPw] = useState('')
  const [lShowPw, setLShowPw] = useState(false)
  const [lError, setLError] = useState<string | null>(null)
  const [lLoading, setLLoading] = useState(false)

  // Register
  const [rName, setRName] = useState('')
  const [rEmail, setREmail] = useState('')
  const [rPw, setRPw] = useState('')
  const [rPwConfirm, setRPwConfirm] = useState('')
  const [rShowPw, setRShowPw] = useState(false)
  const [rShowConfirm, setRShowConfirm] = useState(false)
  const [rPwError, setRPwError] = useState<string | null>(null)
  const [rConfirmError, setRConfirmError] = useState<string | null>(null)
  const [rError, setRError] = useState<string | null>(null)
  const [rLoading, setRLoading] = useState(false)

  // Forgot
  const [fEmail, setFEmail] = useState('')
  const [fLoading, setFLoading] = useState(false)
  const [fSuccess, setFSuccess] = useState(false)

  // Reset
  const [resetPw, setResetPw] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetShowPw, setResetShowPw] = useState(false)
  const [resetShowConfirm, setResetShowConfirm] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)

  const goLogin = () => {
    if (window.location.hash.includes('reset-password')) window.location.hash = ''
    setView('login')
  }

  const SUBTITLE: Record<AuthView, string> = {
    login: t('auth_sign_in_prompt'),
    register: t('auth_create_account'),
    forgot: t('auth_reset_password'),
    reset: t('auth_new_password'),
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLError(null)
    setLLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: lEmail, password: lPw }),
      })
      if (!res.ok) { setLError(t('auth_error')); return }
      const data = await res.json()
      onLogin(data.user)
    } catch { setLError(t('auth_connection_error')) }
    finally { setLLoading(false) }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setRPwError(null); setRConfirmError(null); setRError(null)
    if (pwStrength(rPw) < 2) { setRPwError(t('auth_password_weak')); return }
    if (rPw !== rPwConfirm) { setRConfirmError(t('auth_password_mismatch')); return }
    setRLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ first_name: rName, email: rEmail, password: rPw }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setRError((d as { detail?: string }).detail ?? t('auth_account_error'))
        return
      }
      const data = await res.json()
      onLogin(data.user)
    } catch { setRError(t('auth_connection_error')) }
    finally { setRLoading(false) }
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setFLoading(true)
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fEmail }),
      })
      setFSuccess(true)
    } finally { setFLoading(false) }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetError(null)
    if (resetPw.length < 8) { setResetError(t('auth_min_8_chars')); return }
    if (resetPw !== resetConfirm) { setResetError(t('auth_password_mismatch')); return }
    setResetLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password: resetPw }),
      })
      if (!res.ok) { setResetError(t('auth_link_expired')); return }
      setResetSuccess(true)
    } catch { setResetError(t('auth_connection_error')) }
    finally { setResetLoading(false) }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-page)', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 14, padding: 36,
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 }}>
            <img src={homepoolSidebarLogo} alt="homepool" width={40} height={40} style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, fontFamily: 'Sora, sans-serif' }}>
                <span style={{ color: 'var(--text-primary)' }}>home</span>
                <span style={{ color: 'var(--accent)' }}>pool</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'IBM Plex Mono', monospace", marginTop: 3, letterSpacing: '0.04em' }}>
                {t('auth_my_pool')}
              </div>
            </div>
          </div>
          {/* Subtitle */}
          <p style={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 11, color: 'var(--text-muted)',
            textAlign: 'center', margin: '0 0 28px',
          }}>
            {SUBTITLE[view]}
          </p>

          {/* ── LOGIN ── */}
          {view === 'login' && (
            <form onSubmit={handleLogin} style={{ display: 'grid', gap: 14 }}>
              <div>
                <FieldLabel>{t('auth_email')}</FieldLabel>
                <FieldInput
                  type="email" value={lEmail} onChange={e => setLEmail(e.target.value)}
                  placeholder={t('auth_email_placeholder')} required
                />
              </div>
              <div>
                <FieldLabel>{t('auth_password')}</FieldLabel>
                <PwField value={lPw} onChange={setLPw} show={lShowPw} onToggle={() => setLShowPw(p => !p)} />
              </div>
              {lError && <AlertBand>{lError}</AlertBand>}
              <PrimaryBtn loading={lLoading}>{lLoading ? t('auth_login_loading') : t('auth_login')}</PrimaryBtn>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button type="button" onClick={() => setView('register')} style={linkStyle}>
                  {t('auth_no_account')}
                </button>
                <button type="button" onClick={() => setView('forgot')} style={linkStyle}>
                  {t('auth_forgot')}
                </button>
              </div>
            </form>
          )}

          {/* ── ACCOUNT CREATION ── */}
          {view === 'register' && (
            <form onSubmit={handleRegister} style={{ display: 'grid', gap: 14 }}>
              <div>
                <FieldLabel>{t('auth_first_name')}</FieldLabel>
                <FieldInput
                  type="text" value={rName} onChange={e => setRName(e.target.value)}
                  placeholder={t('auth_first_name_placeholder')} required
                />
              </div>
              <div>
                <FieldLabel>{t('auth_email')}</FieldLabel>
                <FieldInput
                  type="email" value={rEmail} onChange={e => setREmail(e.target.value)}
                  placeholder={t('auth_email_placeholder')} required
                />
              </div>
              <div>
                <FieldLabel>{t('auth_password')}</FieldLabel>
                <PwField
                  value={rPw} onChange={setRPw}
                  show={rShowPw} onToggle={() => setRShowPw(p => !p)}
                  error={!!rPwError}
                />
                <StrengthBar password={rPw} />
                {rPwError && <FieldError>{rPwError}</FieldError>}
              </div>
              <div>
                <FieldLabel>{t('auth_confirm_password')}</FieldLabel>
                <PwField
                  value={rPwConfirm} onChange={setRPwConfirm}
                  show={rShowConfirm} onToggle={() => setRShowConfirm(p => !p)}
                  error={!!rConfirmError}
                />
                {rConfirmError && <FieldError>{rConfirmError}</FieldError>}
              </div>
              {rError && <AlertBand>{rError}</AlertBand>}
              <PrimaryBtn loading={rLoading}>{rLoading ? t('auth_create_loading') : t('auth_create')}</PrimaryBtn>
              <div>
                <button type="button" onClick={() => setView('login')} style={linkStyle}>
                  {t('auth_have_account')}
                </button>
              </div>
            </form>
          )}

          {/* ── FORGOT PASSWORD ── */}
          {view === 'forgot' && (
            fSuccess ? (
              <div style={{ display: 'grid', gap: 20 }}>
                <AlertBand variant="success">
                  {t('auth_reset_sent')}
                </AlertBand>
                <button type="button" onClick={goLogin} style={linkStyle}>
                  {t('auth_back')}
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgot} style={{ display: 'grid', gap: 14 }}>
                <div>
                  <FieldLabel>{t('auth_email')}</FieldLabel>
                  <FieldInput
                    type="email" value={fEmail} onChange={e => setFEmail(e.target.value)}
                    placeholder={t('auth_email_placeholder')} required
                  />
                </div>
                <PrimaryBtn loading={fLoading}>
                  {fLoading ? t('auth_send_loading') : t('auth_send')}
                </PrimaryBtn>
                <button type="button" onClick={goLogin} style={linkStyle}>
                  {t('auth_back')}
                </button>
              </form>
            )
          )}

          {/* ── PASSWORD RESET ── */}
          {view === 'reset' && (
            resetSuccess ? (
              <div style={{ display: 'grid', gap: 20 }}>
                <AlertBand variant="success">
                  {t('auth_password_changed')}
                </AlertBand>
                <button type="button" onClick={goLogin} style={linkStyle}>
                  {t('auth_sign_in_link')}
                </button>
              </div>
            ) : (
              <form onSubmit={handleReset} style={{ display: 'grid', gap: 14 }}>
                {!resetToken && (
                  <AlertBand>{t('auth_link_invalid')}</AlertBand>
                )}
                <div>
                  <FieldLabel>{t('auth_new_password')}</FieldLabel>
                  <PwField
                    value={resetPw} onChange={setResetPw}
                    show={resetShowPw} onToggle={() => setResetShowPw(p => !p)}
                  />
                  <StrengthBar password={resetPw} />
                </div>
                <div>
                  <FieldLabel>{t('auth_confirm_password')}</FieldLabel>
                  <PwField
                    value={resetConfirm} onChange={setResetConfirm}
                    show={resetShowConfirm} onToggle={() => setResetShowConfirm(p => !p)}
                  />
                </div>
                {resetError && <AlertBand>{resetError}</AlertBand>}
                <PrimaryBtn loading={resetLoading} disabled={!resetToken}>
                  {resetLoading ? t('auth_save_password_loading') : t('auth_save_password')}
                </PrimaryBtn>
                <button type="button" onClick={goLogin} style={linkStyle}>
                  {t('auth_back')}
                </button>
              </form>
            )
          )}
        </div>
      </div>
    </div>
  )
}
