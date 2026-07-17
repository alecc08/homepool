import { useState, useEffect, useCallback } from 'react'
import type { Action, Product, User } from './types'
import { useTheme, type Theme } from './hooks/useTheme'
import { useLocale } from './i18n/useLocale'
import { LocaleContext, useT } from './context/LocaleContext'
import { InstallationProvider, useInstallation } from './context/InstallationContext'
import Topbar from './components/Topbar'
import ActionForm from './components/ActionForm'
import ProfileDialog from './components/ProfileDialog'
import DashboardPage from './components/DashboardPage'
import MeasurementsPage from './components/MeasurementsPage'
import HistoryPage from './components/HistoryPage'
import LoginPage from './components/LoginPage'
import InstallationModal from './components/InstallationModal'
import InstallBanner from './components/InstallBanner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Page = 'log' | 'measurements' | 'history'

function getPageFromHash(): Page {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash === 'measurements') return 'measurements'
  if (hash === 'history') return 'history'
  return 'log'
}

// ── Authenticated main app (inside InstallationProvider) ───────────────────

type AppMainProps = {
  user: User
  onLogout: () => void
  onUserUpdate: (u: User) => void
  theme: Theme
  setTheme: (t: Theme) => void
}

function AppMain({ user, onLogout, onUserUpdate, theme, setTheme }: AppMainProps) {
  const { active } = useInstallation()
  const [editingInstallation, setEditingInstallation] = useState(false)
  const { t } = useT()
  const [actions, setActions] = useState<Action[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingAction, setEditingAction] = useState<Action | null>(null)
  const [deletingAction, setDeletingAction] = useState<Action | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showInstallationModal, setShowInstallationModal] = useState(false)
  const [page, setPage] = useState<Page>(getPageFromHash)

  useEffect(() => {
    const handler = () => setPage(getPageFromHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  const navigate = (p: Page) => {
    window.location.hash = p === 'log' ? '' : p
    setPage(p)
  }

  const loadData = useCallback(async () => {
    if (!active) return
    setLoading(true)
    setError(null)
    try {
      const [actionsData, productsData] = await Promise.all([
        fetch(`/api/actions?installation_id=${active.id}`, { credentials: 'same-origin' }).then(r => r.json()),
        fetch('/api/products', { credentials: 'same-origin' }).then(r => r.json()),
      ])
      setActions(actionsData)
      setProducts(productsData)
    } catch {
      setError(t('unable_to_load'))
    } finally {
      setLoading(false)
    }
  }, [active?.id])

  useEffect(() => {
    if (active) loadData()
  }, [active?.id])

  const handleAdd = async (newActions: Omit<Action, 'id' | 'created_at' | 'user_id'>[]) => {
    const posted = await Promise.all(
      newActions.map(a =>
        fetch('/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ ...a, installation_id: active?.id ?? null }),
        }).then(r => r.json() as Promise<Action>)
      )
    )
    setActions(prev => [...prev, ...posted].sort((a, b) => b.date.localeCompare(a.date)))
  }

  const handleExport = () => {
    const blob = new Blob(
      [JSON.stringify({ version: 1, exported_at: new Date().toISOString(), actions }, null, 2)],
      { type: 'application/json' }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pooly-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const importedActions: Action[] = Array.isArray(data) ? data : data.actions
      if (!Array.isArray(importedActions)) throw new Error()
      if (!window.confirm(
        `${t('import_confirm_prefix')} ${importedActions.length} ${t('import_confirm_suffix')}`
      )) return
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(importedActions),
      })
      if (!res.ok) throw new Error()
      await loadData()
    } catch {
      alert(t('import_error'))
    }
  }

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/actions/${id}`, { method: 'DELETE', credentials: 'same-origin' })
      if (!res.ok) throw new Error('Error deleting entry')
      setActions(prev => prev.filter(a => a.id !== id))
      setDeletingAction(null)
    } catch {
      alert(t('app_delete_error'))
    }
  }

  const handleUpdateProfile = async (firstName: string, currentPassword?: string, newPassword?: string) => {
    const res = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ first_name: firstName, current_password: currentPassword, new_password: newPassword }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.detail || t('generic_error'))
    }
    const data = await res.json()
    onUserUpdate(data.user)
  }

  const handleEdit = async (id: number, data: Omit<Action, 'id' | 'created_at' | 'user_id'>) => {
    try {
      const res = await fetch(`/api/actions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ...data, installation_id: active?.id ?? null }),
      })
      if (!res.ok) throw new Error('Error updating entry')
      const updated: Action = await res.json()
      setActions(prev => prev.map(a => a.id === id ? updated : a).sort((a, b) => b.date.localeCompare(a.date)))
      setEditingAction(null)
    } catch {
      alert(t('app_update_error'))
    }
  }

  if (loading && actions.length === 0) return <div className="page-loading">{t('loading')}</div>
  if (error) return <div className="page-loading" style={{ color: 'var(--pooly-bad-text)' }}>{error}</div>

  return (
    <div className="app-layout">
      <Topbar
        onAdd={() => setShowForm(true)}
        onLogout={onLogout}
        onProfile={() => setShowProfile(true)}
        onAddInstallation={() => setShowInstallationModal(true)}
        onEditInstallation={() => setEditingInstallation(true)}
        page={page}
        onNavigate={navigate}
        user={user}
        theme={theme}
        setTheme={setTheme}
      />

      <main className="main-content">
        {page === 'measurements'
          ? <MeasurementsPage actions={actions} />
          : page === 'history'
          ? <HistoryPage actions={actions} products={products} onEdit={setEditingAction} onDelete={setDeletingAction} />
          : <DashboardPage actions={actions} products={products} onEdit={setEditingAction} onDelete={setDeletingAction} onExport={handleExport} onImport={handleImport} />
        }
      </main>

      {/* Dialog — new entry */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: '"Sora", sans-serif', fontWeight: 600 }}>
              {t('modal_title')}
            </DialogTitle>
          </DialogHeader>
          <ActionForm onAdd={handleAdd} products={products} onClose={() => setShowForm(false)} />
        </DialogContent>
      </Dialog>

      {/* Dialog — edit */}
      <Dialog open={!!editingAction} onOpenChange={open => { if (!open) setEditingAction(null) }}>
        <DialogContent className="sm:max-w-md" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: '"Sora", sans-serif', fontWeight: 600 }}>
              {t('modal_edit')}
            </DialogTitle>
          </DialogHeader>
          {editingAction && (
            <ActionForm
              products={products}
              editAction={editingAction}
              onEdit={handleEdit}
              onClose={() => setEditingAction(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog — delete confirmation */}
      <Dialog open={!!deletingAction} onOpenChange={open => { if (!open) setDeletingAction(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: '"Sora", sans-serif', fontWeight: 600 }}>
              {t('modal_delete_title')}
            </DialogTitle>
          </DialogHeader>
          {deletingAction && (
            <div>
              <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 20px' }}>
                <strong>{deletingAction.action_type}</strong> {t('modal_delete_on')}{' '}
                {deletingAction.date.split('-').reverse().join('/')}.{' '}
                {t('modal_delete_irreversible')}
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setDeletingAction(null)}
                  style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-surface)', cursor: 'pointer', color: 'var(--text-secondary)' }}
                >
                  {t('modal_cancel')}
                </button>
                <button
                  onClick={() => handleDelete(deletingAction.id)}
                  style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 7, border: 'none', background: 'var(--status-danger-text)', cursor: 'pointer', color: 'var(--bg-surface)' }}
                >
                  {t('modal_delete')}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog — profile */}
      <Dialog open={showProfile} onOpenChange={setShowProfile}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: '"Sora", sans-serif', fontWeight: 600 }}>
              {t('profile_title')}
            </DialogTitle>
          </DialogHeader>
          <ProfileDialog
            user={user}
            onSave={handleUpdateProfile}
            onClose={() => setShowProfile(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Modal — new installation */}
      <InstallationModal
        open={showInstallationModal}
        onClose={() => setShowInstallationModal(false)}
      />

      {/* Modal — edit installation */}
      {active && (
        <InstallationModal
          open={editingInstallation}
          onClose={() => setEditingInstallation(false)}
          installation={active}
        />
      )}

      {/* PWA install banner */}
      <InstallBanner />
    </div>
  )
}

// ── Root App component ─────────────────────────────────────────────────────

export default function App() {
  const { theme, setTheme } = useTheme()
  const localeValue = useLocale()
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    fetch('/api/me', { credentials: 'same-origin' })
      .then(async res => {
        if (!res.ok) return null
        const data = await res.json()
        return data.user as User
      })
      .then(u => setUser(u))
      .finally(() => setAuthLoading(false))
  }, [])

  const handleLoginSuccess = (u: User) => setUser(u)

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    setUser(null)
  }

  if (authLoading) return <div className="page-loading">{localeValue.t('loading')}</div>

  return (
    <LocaleContext.Provider value={localeValue}>
      {!user
        ? <LoginPage onLogin={handleLoginSuccess} />
        : (
          <InstallationProvider>
            <AppMain
              user={user}
              onLogout={handleLogout}
              onUserUpdate={setUser}
              theme={theme}
              setTheme={setTheme}
            />
          </InstallationProvider>
        )
      }
    </LocaleContext.Provider>
  )
}
