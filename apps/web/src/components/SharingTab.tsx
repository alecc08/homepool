import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Installation, InstallationShare } from '../types'
import { useT } from '../context/LocaleContext'

type ShareRole = InstallationShare['role']

type Props = { installation: Installation }

export default function SharingTab({ installation }: Props) {
  const { t } = useT()
  const [shares, setShares] = useState<InstallationShare[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ShareRole>('viewer')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/installations/${installation.id}/shares`

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(base, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('failed')
      setShares(await res.json())
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { load() }, [load])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email.trim()) return
    setAdding(true)
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim(), role }),
      })
      if (!res.ok) {
        // The API distinguishes "no such account" from "already shared"; both
        // are things the owner can act on, so surface them separately.
        if (res.status === 404) throw new Error(t('share_unknown_email'))
        if (res.status === 409) throw new Error(t('share_already_shared'))
        if (res.status === 400) throw new Error(t('share_cannot_share_with_self'))
        throw new Error(t('share_error'))
      }
      const created: InstallationShare = await res.json()
      setShares(prev => [...prev, created])
      setEmail('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('share_error'))
    } finally {
      setAdding(false)
    }
  }

  const handleRoleChange = async (share: InstallationShare, next: ShareRole) => {
    setError(null)
    try {
      const res = await fetch(`${base}/${share.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ role: next }),
      })
      if (!res.ok) throw new Error(t('share_error'))
      const updated: InstallationShare = await res.json()
      setShares(prev => prev.map(s => (s.id === share.id ? updated : s)))
    } catch {
      setError(t('share_error'))
    }
  }

  const handleRevoke = async (share: InstallationShare) => {
    setError(null)
    if (!window.confirm(t('share_revoke_confirm').replace('{email}', share.email))) return
    try {
      const res = await fetch(`${base}/${share.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(t('share_error'))
      setShares(prev => prev.filter(s => s.id !== share.id))
    } catch {
      setError(t('share_error'))
    }
  }

  const hint: React.CSSProperties = {
    fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', margin: 0,
  }
  const roleSelect: React.CSSProperties = {
    padding: '5px 8px', borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', fontFamily: 'Sora, sans-serif', fontSize: 12,
    cursor: 'pointer', outline: 'none', flexShrink: 0,
  }

  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ gap: 14 }}>
      <p style={hint}>{t('share_intro')}</p>

      {loading && <p style={hint}>{t('share_loading')}</p>}
      {loadError && (
        <p style={{ ...hint, color: 'var(--status-danger-text)' }}>{t('share_load_error')}</p>
      )}

      {!loading && !loadError && (
        <div className="flex-1 overflow-y-auto overscroll-contain" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shares.length === 0 && <p style={hint}>{t('share_none')}</p>}

          {shares.map(share => (
            <div
              key={share.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                paddingBottom: 10, borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600,
                  color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {share.first_name || share.email}
                </div>
                <div style={{
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {share.email}
                </div>
              </div>

              <select
                value={share.role}
                onChange={e => handleRoleChange(share, e.target.value as ShareRole)}
                aria-label={t('share_role')}
                style={roleSelect}
              >
                <option value="viewer">{t('share_role_viewer')}</option>
                <option value="editor">{t('share_role_editor')}</option>
              </select>

              <button
                type="button"
                onClick={() => handleRevoke(share)}
                aria-label={t('share_revoke')}
                title={t('share_revoke')}
                style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} style={{ display: 'grid', gap: 8, flexShrink: 0 }}>
        <Label htmlFor="share-email">{t('share_add_label')}</Label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            id="share-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={t('share_email_placeholder')}
            style={{ flex: 1, minWidth: 0 }}
          />
          <select
            value={role}
            onChange={e => setRole(e.target.value as ShareRole)}
            aria-label={t('share_role')}
            style={roleSelect}
          >
            <option value="viewer">{t('share_role_viewer')}</option>
            <option value="editor">{t('share_role_editor')}</option>
          </select>
        </div>
        <p style={hint}>
          {role === 'viewer' ? t('share_role_viewer_hint') : t('share_role_editor_hint')}
        </p>

        {error && (
          <p style={{ ...hint, color: 'var(--status-danger-text)' }}>{error}</p>
        )}

        <Button type="submit" disabled={adding || !email.trim()}>
          {adding ? t('share_adding') : t('share_add')}
        </Button>
      </form>
    </div>
  )
}
