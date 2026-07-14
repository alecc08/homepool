import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { User } from '../types'
import { useT } from '../context/LocaleContext'

type Props = {
  user: User
  onSave: (firstName: string, currentPassword?: string, newPassword?: string) => Promise<void>
  onClose: () => void
}

export default function ProfileDialog({ user, onSave, onClose }: Props) {
  const { t } = useT()
  const [firstName, setFirstName] = useState(user.first_name)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const [hasApiKey, setHasApiKey] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [apiKeyLoading, setApiKeyLoading] = useState(false)
  const [apiKeyError, setApiKeyError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/me/api-key', { credentials: 'same-origin' })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setHasApiKey(data.exists) })
      .catch(() => {})
  }, [])

  async function handleGenerateApiKey() {
    setApiKeyError('')
    setApiKeyLoading(true)
    try {
      const res = await fetch('/api/me/api-key', { method: 'POST', credentials: 'same-origin' })
      if (!res.ok) throw new Error(t('generic_error'))
      const data = await res.json()
      setNewApiKey(data.key)
      setHasApiKey(true)
      setCopied(false)
    } catch (err: unknown) {
      setApiKeyError(err instanceof Error ? err.message : t('generic_error'))
    } finally {
      setApiKeyLoading(false)
    }
  }

  async function handleRevokeApiKey() {
    setApiKeyError('')
    setApiKeyLoading(true)
    try {
      const res = await fetch('/api/me/api-key', { method: 'DELETE', credentials: 'same-origin' })
      if (!res.ok) throw new Error(t('generic_error'))
      setHasApiKey(false)
      setNewApiKey(null)
    } catch (err: unknown) {
      setApiKeyError(err instanceof Error ? err.message : t('generic_error'))
    } finally {
      setApiKeyLoading(false)
    }
  }

  async function handleCopyApiKey() {
    if (!newApiKey) return
    try {
      await navigator.clipboard.writeText(newApiKey)
      setCopied(true)
    } catch { /* ignore */ }
  }

  const changingPassword = !!(currentPw || newPw || confirmPw)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (changingPassword) {
      if (!currentPw) { setError(t('profile_current_password_required')); return }
      if (!newPw) { setError(t('profile_new_password_required')); return }
      if (newPw !== confirmPw) { setError(t('profile_password_mismatch')); return }
      if (newPw.length < 8 || !/[A-Z]/.test(newPw) || !/[0-9]/.test(newPw)) {
        setError(t('profile_password_weak'))
        return
      }
    }
    setLoading(true)
    try {
      await onSave(firstName, changingPassword ? currentPw : undefined, changingPassword ? newPw : undefined)
      setSuccess(true)
      setTimeout(onClose, 900)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('generic_error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Label htmlFor="prof-firstName">{t('profile_first_name')}</Label>
          <Input
            id="prof-firstName"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            className="mt-1"
            placeholder={t('profile_first_name_placeholder')}
          />
        </div>

        <Separator />

        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          {t('profile_change_password')}{' '}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('profile_optional')}</span>
        </div>

        <div>
          <Label htmlFor="prof-currentPw">{t('profile_current_password')}</Label>
          <Input
            id="prof-currentPw"
            type="password"
            value={currentPw}
            onChange={e => setCurrentPw(e.target.value)}
            className="mt-1"
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>
        <div>
          <Label htmlFor="prof-newPw">{t('profile_new_password')}</Label>
          <Input
            id="prof-newPw"
            type="password"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            className="mt-1"
            placeholder={t('profile_new_password_placeholder')}
            autoComplete="new-password"
          />
        </div>
        <div>
          <Label htmlFor="prof-confirmPw">{t('profile_confirm')}</Label>
          <Input
            id="prof-confirmPw"
            type="password"
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            className="mt-1"
            placeholder={t('profile_confirm_placeholder')}
            autoComplete="new-password"
          />
        </div>

        {error && (
          <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--status-danger-text)', margin: 0 }}>
            {error}
          </p>
        )}
        {success && (
          <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--status-ok-text)', margin: 0 }}>
            {t('profile_saved')}
          </p>
        )}

        <Separator />

        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          {t('profile_api_access')}
        </div>
        <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          {t('profile_api_access_desc')}
        </p>

        {newApiKey ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input readOnly value={newApiKey} style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12 }} />
              <Button type="button" variant="outline" onClick={handleCopyApiKey}>
                {copied ? t('profile_api_key_copied') : t('profile_api_key_copy')}
              </Button>
            </div>
            <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--status-warn-text)', margin: 0 }}>
              {t('profile_api_key_shown_once')}
            </p>
          </div>
        ) : (
          <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            {hasApiKey ? t('profile_api_key_exists') : t('profile_api_key_none')}
          </p>
        )}

        {apiKeyError && (
          <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--status-danger-text)', margin: 0 }}>
            {apiKeyError}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="button" variant="outline" disabled={apiKeyLoading} onClick={handleGenerateApiKey}>
            {hasApiKey ? t('profile_api_key_regenerate') : t('profile_api_key_generate')}
          </Button>
          {hasApiKey && (
            <Button type="button" variant="ghost" disabled={apiKeyLoading} onClick={handleRevokeApiKey}>
              {t('profile_api_key_revoke')}
            </Button>
          )}
        </div>
      </div>

      {/* Fixed footer — always visible */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" onClick={onClose}>{t('modal_cancel')}</Button>
        <Button type="submit" disabled={loading}>
          {loading ? t('profile_saving') : t('profile_save')}
        </Button>
      </div>

    </form>
  )
}
