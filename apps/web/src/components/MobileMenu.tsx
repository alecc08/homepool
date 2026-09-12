import { Waves, Bath, Pencil, Plus, Trash2, LogOut, ShieldCheck, User as UserIcon } from 'lucide-react'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import { ThemeSwitch, LocaleSwitch } from './Switches'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Props = {
  open: boolean
  onClose: () => void
  onLogout?: () => void
  onProfile?: () => void
  /** Only passed for administrators — undefined hides the entry entirely. */
  onAdmin?: () => void
  onAddInstallation?: () => void
  onEditInstallation?: () => void
  theme: 'auto' | 'light' | 'dark'
  setTheme?: (t: 'auto' | 'light' | 'dark') => void
}

/**
 * The mobile equivalent of the desktop sidebar footer: it is where the phone
 * hides the whole sidebar (the 768px breakpoint), so without it a phone user
 * has no way to switch pools, edit a pool's settings, change theme/language,
 * or reach their profile. Add/edit open the same installation dialog the
 * desktop uses (the caller owns that state); only delete is handled here,
 * exactly as the sidebar footer does.
 */
export default function MobileMenu({
  open, onClose, onLogout, onProfile, onAdmin, onAddInstallation, onEditInstallation, theme, setTheme,
}: Props) {
  const { installations, active, setActive, deleteInstallation, isOwner } = useInstallation()
  const { t, locale, setLocale } = useT()

  const installationActionLabel = isOwner
    ? t('nav_edit_installation')
    : t('nav_installation_details')
  const InstallationIcon = active?.type === 'spa' ? Bath : Waves

  const handleDeleteInstallation = async () => {
    if (!active) return
    if (!window.confirm(t('installation_confirm_delete').replace('{name}', active.name))) return
    try {
      await deleteInstallation(active.id)
    } catch {
      alert(t('installation_delete_error'))
    }
  }

  // The active installation's row: a dropdown to switch (mirrors the desktop
  // sidebar) when there is more than one pool, or just the name with the
  // actions when there is a single one.
  const renderInstallationRow = () => {
    if (!active) return null
    if (installations.length > 1) {
      return (
        <div className="mm-inst">
          <div className="mm-inst-label">{t('my_installation')}</div>
          <div className="mm-inst-controls">
            <select
              className="mm-select"
              aria-label={t('my_installation')}
              value={active.id ?? ''}
              onChange={e => setActive(Number(e.target.value))}
            >
              {installations.map(i => (
                <option key={i.id} value={i.id}>
                  {i.role === 'owner' ? i.name : `${i.name} · ${i.owner_name ?? ''}`}
                </option>
              ))}
            </select>
            {onEditInstallation && (
              <button type="button" className="mm-icon-btn" onClick={onEditInstallation} aria-label={installationActionLabel} title={installationActionLabel}>
                <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
            {isOwner && (
              <button type="button" className="mm-icon-btn" onClick={handleDeleteInstallation} aria-label={t('installation_delete')} title={t('installation_delete')}>
                <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )
    }
    return (
      <div className="mm-inst mm-inst--single">
        <div className="mm-inst-label">{t('my_installation')}</div>
        <div className="mm-inst-name">
          <InstallationIcon size={15} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span className="mm-inst-name-text">{active.name}</span>
          {onEditInstallation && (
            <button type="button" className="mm-icon-btn" onClick={onEditInstallation} aria-label={installationActionLabel} title={installationActionLabel}>
              <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
          {isOwner && (
            <button type="button" className="mm-icon-btn" onClick={handleDeleteInstallation} aria-label={t('installation_delete')} title={t('installation_delete')}>
              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="mm-content">
        <DialogHeader>
          <DialogTitle>{t('nav_menu')}</DialogTitle>
        </DialogHeader>

        <section className="mm-section">
          {renderInstallationRow()}
          {onAddInstallation && (
            <button type="button" className="mm-add" onClick={onAddInstallation}>
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              {t('nav_add_installation')}
            </button>
          )}
        </section>

        <section className="mm-section">
          {onProfile && (
            <button type="button" className="mm-row" onClick={onProfile}>
              <UserIcon size={15} strokeWidth={1.75} aria-hidden="true" />
              {t('nav_my_profile')}
            </button>
          )}
          {onAdmin && (
            <button type="button" className="mm-row" onClick={onAdmin}>
              <ShieldCheck size={15} strokeWidth={1.75} aria-hidden="true" />
              {t('nav_administration')}
            </button>
          )}
        </section>

        <section className="mm-section mm-section--prefs">
          {setTheme && <ThemeSwitch theme={theme} setTheme={setTheme} />}
          <LocaleSwitch locale={locale} setLocale={setLocale} />
        </section>

        <section className="mm-section">
          {onLogout && (
            <button type="button" className="mm-row mm-row--danger" onClick={onLogout}>
              <LogOut size={15} strokeWidth={1.75} aria-hidden="true" />
              {t('nav_logout')}
            </button>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}
