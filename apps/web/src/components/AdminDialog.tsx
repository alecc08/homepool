import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { AdminUser, User } from '../types'
import { useT } from '../context/LocaleContext'

type Props = {
  open: boolean
  onClose: () => void
  currentUser: User
}

export default function AdminDialog({ open, onClose, currentUser }: Props) {
  const { t } = useT()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [allowRegistration, setAllowRegistration] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [usersRes, settingsRes] = await Promise.all([
        fetch('/api/admin/users', { credentials: 'same-origin' }),
        fetch('/api/admin/settings', { credentials: 'same-origin' }),
      ])
      if (!usersRes.ok || !settingsRes.ok) throw new Error('failed')
      setUsers(await usersRes.json())
      setAllowRegistration((await settingsRes.json()).allow_registration)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleToggleRegistration = async (next: boolean) => {
    setError(null)
    const previous = allowRegistration
    setAllowRegistration(next)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ allow_registration: next }),
      })
      if (!res.ok) throw new Error('failed')
    } catch {
      setAllowRegistration(previous)
      setError(t('admin_save_error'))
    }
  }

  const handleToggleAdmin = async (user: AdminUser, next: boolean) => {
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ is_admin: next }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail ?? t('admin_save_error'))
      setUsers(prev => prev.map(u => (u.id === user.id ? data : u)))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('admin_save_error'))
    }
  }

  const handleDelete = async (user: AdminUser) => {
    setError(null)
    if (!window.confirm(t('admin_delete_confirm').replace('{email}', user.email))) return
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.detail ?? t('admin_save_error'))
      }
      setUsers(prev => prev.filter(u => u.id !== user.id))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('admin_save_error'))
    }
  }

  const sectionTitle: React.CSSProperties = {
    fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600,
    color: 'var(--text-secondary)',
  }
  const hint: React.CSSProperties = {
    fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', margin: 0,
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: '"Sora", sans-serif', fontWeight: 600 }}>
            {t('admin_title')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0" style={{ gap: 14 }}>
          {loading && <p style={hint}>{t('admin_loading')}</p>}
          {loadError && (
            <p style={{ ...hint, color: 'var(--status-danger-text)' }}>{t('admin_load_error')}</p>
          )}

          {!loading && !loadError && (
            <div className="flex-1 overflow-y-auto overscroll-contain" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={sectionTitle}>{t('admin_registration_section')}</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={allowRegistration}
                  onChange={e => handleToggleRegistration(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)', flexShrink: 0, cursor: 'pointer' }}
                />
                <span style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-primary)' }}>
                  {t('admin_allow_registration')}
                </span>
              </label>
              <p style={hint}>{t('admin_allow_registration_hint')}</p>

              <Separator />

              <div style={sectionTitle}>{t('admin_accounts_section')}</div>
              {users.map(u => (
                <div
                  key={u.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    paddingBottom: 10, borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {u.first_name || u.email}
                      {u.id === currentUser.id && (
                        <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {t('admin_you')}</span>
                      )}
                    </div>
                    <div style={{
                      fontFamily: "'IBM Plex Mono', monospace", fontSize: 10,
                      color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {u.email} · {t('admin_installations_count').replace('{n}', String(u.installation_count))}
                    </div>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={u.is_admin}
                      onChange={e => handleToggleAdmin(u, e.target.checked)}
                      style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }}
                    />
                    <span style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-secondary)' }}>
                      {t('admin_role_admin')}
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={() => handleDelete(u)}
                    disabled={u.id === currentUser.id}
                    aria-label={t('admin_delete_user')}
                    title={t('admin_delete_user')}
                    style={{
                      flexShrink: 0, width: 26, height: 26, borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      cursor: u.id === currentUser.id ? 'not-allowed' : 'pointer',
                      opacity: u.id === currentUser.id ? 0.4 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <p style={{ ...hint, color: 'var(--status-danger-text)' }}>{error}</p>
          )}

          <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="button" variant="ghost" onClick={onClose}>{t('common_close')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
