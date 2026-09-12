import { useState } from 'react'
import { Bath, Waves, Pencil, Plus, Trash2, Home, Activity, Clock, ClipboardList, Wrench, LogOut, ShieldCheck, User as UserIcon, Settings } from 'lucide-react'
import homepoolLogo from '@/assets/homepool-logo.svg'
import homepoolSidebarLogo from '@/assets/homepool-logo-sidebar.svg'
import type { User } from '../types'
import type { Theme } from '../hooks/useTheme'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import { ThemeSwitch, LocaleSwitch } from './Switches'
import BottomNav from './BottomNav'
import MobileMenu from './MobileMenu'

type Page = 'log' | 'measurements' | 'history' | 'recommendations' | 'maintenance'

type Props = {
  onAdd?: () => void
  onLogout?: () => void
  onProfile?: () => void
  /** Only passed for administrators — undefined hides the entry entirely. */
  onAdmin?: () => void
  onAddInstallation?: () => void
  onEditInstallation?: () => void
  page?: Page
  onNavigate?: (page: Page) => void
  user?: User
  theme?: Theme
  setTheme?: (t: Theme) => void
}

const NAV_ITEMS: { page: Page; labelKey: 'nav_log' | 'nav_measurements' | 'nav_history' | 'nav_recommendations' | 'nav_maintenance'; Icon: typeof Home }[] = [
  { page: 'log', labelKey: 'nav_log', Icon: Home },
  { page: 'measurements', labelKey: 'nav_measurements', Icon: Activity },
  { page: 'maintenance', labelKey: 'nav_maintenance', Icon: Wrench },
  { page: 'history', labelKey: 'nav_history', Icon: Clock },
  { page: 'recommendations', labelKey: 'nav_recommendations', Icon: ClipboardList },
]

export default function Topbar({ onAdd, onLogout, onProfile, onAdmin, onAddInstallation, onEditInstallation, page = 'log', onNavigate, user, theme = 'auto', setTheme }: Props) {
  const { installations, active, setActive, deleteInstallation, isOwner } = useInstallation()
  const { t, locale, setLocale } = useT()
  // The mobile settings sheet is the phone's replacement for the whole desktop
  // sidebar; while it's open the header and bottom nav step aside.
  const [menuOpen, setMenuOpen] = useState(false)

  const installationLabel = active?.type === 'spa'
    ? t('my_spa')
    : active?.type === 'pool'
    ? t('my_pool')
    : t('my_installation')

  const handleDeleteInstallation = async () => {
    if (!active) return
    if (!window.confirm(t('installation_confirm_delete').replace('{name}', active.name))) return
    try {
      await deleteInstallation(active.id)
    } catch {
      alert(t('installation_delete_error'))
    }
  }

  // Non-owners get the same button, but it opens the shared-installation view
  // (who owns it, what your role allows, and "leave") rather than the edit form.
  const installationActionLabel = isOwner
    ? t('nav_edit_installation')
    : t('nav_installation_details')

  const InstallationIcon = active?.type === 'spa' ? Bath : Waves

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────── */}
      <aside className="sidebar">
        {/* Logo */}
        <div style={{
          padding: '0 16px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <img
            src={homepoolSidebarLogo}
            alt="homepool"
            width={32}
            height={32}
            style={{ flexShrink: 0 }}
          />
          <div>
            <div style={{
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              fontFamily: 'Sora, sans-serif',
            }}>
              <span style={{ color: 'var(--text-primary)' }}>home</span>
              <span style={{ color: 'var(--accent)' }}>pool</span>
            </div>
            <div style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              fontFamily: "'IBM Plex Mono', monospace",
              marginTop: 3,
              letterSpacing: '0.04em',
            }}>
              {user?.first_name ? `${t('hello')} ${user.first_name.toUpperCase()}` : installationLabel}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {/* Logging an entry is the thing this app is for, so it leads the nav
              rather than hiding on the dashboard. Absent for viewers, who have
              nothing to log. The mobile equivalent is BottomNav's FAB. */}
          {onAdd && (
            <button className="sidebar-add-entry" onClick={onAdd}>
              <Plus size={15} strokeWidth={2.25} aria-hidden="true" />
              {t('nav_new_entry')}
            </button>
          )}
          {NAV_ITEMS.map(({ page: p, labelKey, Icon }) => (
            <button
              key={p}
              className={`sidebar-nav-item${page === p ? ' active' : ''}`}
              onClick={() => onNavigate?.(p)}
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        {/* Footer: installation + preferences + profile */}
        <div className="sidebar-footer">
          {/* Installation selector */}
          {installations.length > 0 && (
            <div style={{ padding: '2px 0 6px' }}>
              {installations.length === 1 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <InstallationIcon size={14} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <span style={{ fontFamily: 'Sora, sans-serif', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {active?.name ?? '…'}
                    </span>
                    {onEditInstallation && (
                      <button
                        type="button"
                        onClick={onEditInstallation}
                        aria-label={installationActionLabel}
                        title={installationActionLabel}
                        style={{
                          flexShrink: 0, width: 22, height: 22, borderRadius: 'var(--radius-sm)',
                          background: 'none', border: 'none',
                          color: 'var(--text-muted)', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Pencil size={12} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {active?.volume != null && (
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-muted)', marginLeft: 21 }}>
                      {active.volume.toLocaleString('fr-FR')} {active.volume_unit ?? 'L'}
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '0 12px' }}>
                  <select
                    value={active?.id ?? ''}
                    onChange={e => setActive(Number(e.target.value))}
                    style={{
                      flex: 1, width: '100%', padding: '5px 8px', borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      color: 'var(--text-secondary)', fontFamily: 'Sora, sans-serif', fontSize: 12,
                      cursor: 'pointer', outline: 'none',
                    }}
                  >
                    {installations.map(i => (
                      <option key={i.id} value={i.id}>
                        {i.role === 'owner' ? i.name : `${i.name} · ${i.owner_name ?? ''}`}
                      </option>
                    ))}
                  </select>
                  {onEditInstallation && (
                    <button
                      type="button"
                      onClick={onEditInstallation}
                      aria-label={installationActionLabel}
                      title={installationActionLabel}
                      style={{
                        flexShrink: 0, width: 26, height: 26, borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-surface)', border: '1px solid var(--border)',
                        color: 'var(--text-muted)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Pencil size={12} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  )}
                  {isOwner && (
                  <button
                    type="button"
                    onClick={handleDeleteInstallation}
                    aria-label={t('installation_delete')}
                    title={t('installation_delete')}
                    style={{
                      flexShrink: 0, width: 26, height: 26, borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      color: 'var(--text-muted)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                  )}
                </div>
              )}
              {onAddInstallation && (
                <button
                  onClick={onAddInstallation}
                  style={{
                    marginTop: 4, width: '100%', background: 'none', border: 'none',
                    fontFamily: 'Sora, sans-serif', fontSize: 10, color: 'var(--text-muted)',
                    cursor: 'pointer', textAlign: 'left', padding: '2px 12px',
                  }}
                >
                  {t('nav_add_installation')}
                </button>
              )}
            </div>
          )}

          {setTheme && <ThemeSwitch theme={theme} setTheme={setTheme} />}
          <LocaleSwitch locale={locale} setLocale={setLocale} />

          {onProfile && (
            <button className="btn-sidebar-logout" onClick={onProfile} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserIcon size={13} strokeWidth={1.75} aria-hidden="true" />
              {t('nav_my_profile')}
            </button>
          )}
          {onAdmin && (
            <button className="btn-sidebar-logout" onClick={onAdmin} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" />
              {t('nav_administration')}
            </button>
          )}
          {onLogout && (
            <button className="btn-sidebar-logout" onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <LogOut size={13} strokeWidth={1.75} aria-hidden="true" />
              {t('nav_logout')}
            </button>
          )}
          <div style={{
            padding: '6px 12px 8px',
            fontSize: 10,
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--text-muted)',
            letterSpacing: '0.03em',
            userSelect: 'none',
          }}>
            homepool · MIT License
          </div>
        </div>
      </aside>

      {/* ── Mobile top header ───────────────────────────────── */}
      <header className={`mobile-header${menuOpen ? ' mm-hidden' : ''}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <img src={homepoolLogo} alt="homepool" />
          {active?.name && (
            <span style={{ fontFamily: 'Sora, sans-serif', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {active.name}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Opens the settings sheet — the phone's stand-in for the whole
              desktop sidebar (switch/edit pool, settings, theme, profile). */}
          <button
            type="button"
            className="mobile-header-menu"
            aria-label={t('nav_menu')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Settings size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {onLogout && (
            <button className="mobile-header-logout" onClick={onLogout}>
              <LogOut size={14} strokeWidth={1.75} aria-hidden="true" />
              {t('nav_logout_short')}
            </button>
          )}
        </div>
      </header>

      {/* ── Mobile bottom nav ───────────────────────────────── */}
      {onAdd && onNavigate && (
        <BottomNav page={page} onNavigate={onNavigate} onAdd={onAdd} hidden={menuOpen} />
      )}

      {/* ── Mobile settings sheet (phone's replacement for the sidebar) ── */}
      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onLogout={onLogout}
        onProfile={onProfile}
        onAdmin={onAdmin}
        onAddInstallation={onAddInstallation}
        onEditInstallation={onEditInstallation}
        theme={theme}
        setTheme={setTheme}
      />
    </>
  )
}
