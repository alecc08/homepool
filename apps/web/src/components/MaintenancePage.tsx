import { useCallback, useEffect, useState } from 'react'
import { Check, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MaintenanceTask } from '../types'
import type { TranslationKey } from '../i18n/translations'
import {
  maintenanceTaskLabel,
  isMeasurementTask,
  isOnDemandTask,
  isProductTask,
  PRODUCT_ACTION_TYPE,
} from '../utils'
import { TaskIcon } from '../taskIcons'
import type { EntryKind } from './ActionForm'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import MaintenanceConfig from './MaintenanceConfig'

type Translate = (key: TranslationKey) => string

const sectionCardStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: '14px 16px',
  marginBottom: 12,
}

type StatusTone = 'ok' | 'warn' | 'danger' | 'neutral'

function statusFor(task: MaintenanceTask, t: Translate): { label: string; tone: StatusTone } {
  // On-demand tasks (interval 0) are loggable but never scheduled, so they never
  // read as "never done" / overdue.
  if (isOnDemandTask(task)) return { label: t('maint_on_demand'), tone: 'neutral' }
  const days = task.days_until_due
  if (days === null) return { label: t('maint_never_done'), tone: 'neutral' }
  if (days < 0) return { label: `${t('maint_overdue')} · ${Math.abs(days)} ${t('todo_day_abbr')}`, tone: 'danger' }
  if (days === 0) return { label: t('maint_due_today'), tone: 'warn' }
  if (days <= 3) return { label: `${t('maint_due_in')} ${days} ${t('todo_day_abbr')}`, tone: 'warn' }
  return { label: `${t('maint_due_in')} ${days} ${t('todo_day_abbr')}`, tone: 'ok' }
}

const TONE_COLORS: Record<StatusTone, { color: string; bg: string }> = {
  ok: { color: 'var(--status-ok-text)', bg: 'var(--status-ok-bg)' },
  warn: { color: 'var(--status-warn-text)', bg: 'var(--status-warn-bg)' },
  danger: { color: 'var(--status-danger-text)', bg: 'var(--status-danger-bg)' },
  neutral: { color: 'var(--text-muted)', bg: 'var(--bg-surface-2)' },
}

type Props = {
  /** Called after a task is marked done so the rest of the app (history,
   * dashboard) can refresh its action list. */
  onActionLogged?: () => void
  /** Opens the entry form. Tasks whose completion carries data — a measurement,
   * or a product and a quantity — hand off to the form instead of logging an
   * empty row, so there is exactly one way to record them (issue #51). */
  onLogEntry?: (kind: EntryKind, actionType?: string) => void
}

export default function MaintenancePage({ onActionLogged, onLogEntry }: Props) {
  const { active, isOwner, canEdit } = useInstallation()
  const { t } = useT()
  const [tasks, setTasks] = useState<MaintenanceTask[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [flashId, setFlashId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    if (!active) return
    setLoading(true)
    setLoadError(false)
    fetch(`/api/installations/${active.id}/maintenance`, { credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error('failed'); return r.json() })
      .then((data: MaintenanceTask[]) => setTasks(data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [active?.id])

  useEffect(() => { load() }, [load])

  const markDone = async (task: MaintenanceTask) => {
    if (!active) return
    if (onLogEntry && isMeasurementTask(task)) {
      onLogEntry('measurement')
      return
    }
    if (onLogEntry && isProductTask(task)) {
      onLogEntry('maintenance', PRODUCT_ACTION_TYPE)
      return
    }
    setBusyId(task.id)
    try {
      const res = await fetch(
        `/api/installations/${active.id}/maintenance/${task.id}/complete`,
        { method: 'POST', credentials: 'same-origin' },
      )
      if (!res.ok) throw new Error('failed')
      const updated: MaintenanceTask = await res.json()
      setTasks(prev => prev.map(tk => tk.id === updated.id ? updated : tk))
      setFlashId(task.id)
      setTimeout(() => setFlashId(f => (f === task.id ? null : f)), 1600)
      onActionLogged?.()
    } catch {
      /* ignore — leave the row unchanged */
    } finally {
      setBusyId(null)
    }
  }

  const visibleTasks = tasks.filter(tk => tk.enabled)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title" style={{ margin: 0 }}>{t('maintenance_page_title')}</h1>
          <div className="page-header-sub">{t('maintenance_page_sub')}</div>
        </div>
        {isOwner && (
          <div className="page-header-actions">
            <Button type="button" variant="outline" onClick={() => setShowConfig(true)}>
              {t('maint_configure')}
            </Button>
          </div>
        )}
      </div>

      {active && isOwner && (
        <MaintenanceConfig
          installationId={active.id}
          open={showConfig}
          onClose={() => setShowConfig(false)}
          onSaved={load}
        />
      )}

      {loading && tasks.length === 0 && (
        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-muted)' }}>
          {t('ranges_loading')}
        </div>
      )}

      {loadError && (
        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)' }}>
          {t('maint_load_error')}
        </div>
      )}

      {!loading && !loadError && visibleTasks.length === 0 && (
        <div style={{ ...sectionCardStyle, textAlign: 'center' }}>
          <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            {t('maint_empty')}
          </p>
        </div>
      )}

      {visibleTasks.map(task => {
        const status = statusFor(task, t)
        const tone = TONE_COLORS[status.tone]
        const flashing = flashId === task.id
        // These carry data (values, or a product and a quantity), so completing
        // them opens the entry form rather than logging an empty row.
        const opensEntryForm = !!onLogEntry && (isMeasurementTask(task) || isProductTask(task))
        return (
          <div key={task.id} style={sectionCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{
                width: 34, height: 34, borderRadius: 'var(--radius-sm)', flexShrink: 0,
                background: tone.bg, color: tone.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <TaskIcon name={task.icon} size={17} />
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {maintenanceTaskLabel(task, t)}
                </div>
                <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {isOnDemandTask(task)
                    ? t('maint_on_demand')
                    : `${t('maint_every')} ${task.interval_days} ${t('todo_day_abbr')}`}
                  {task.last_date && (
                    <> · {t('maint_last_done')} {task.last_date.split('-').reverse().join('/')}</>
                  )}
                </div>
              </div>

              <span style={{
                fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, fontWeight: 600,
                color: tone.color, background: tone.bg,
                padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {status.label}
              </span>

              {canEdit && (
              <Button
                type="button"
                variant={flashing ? 'default' : 'outline'}
                size="sm"
                disabled={busyId === task.id}
                onClick={() => markDone(task)}
                style={{ flexShrink: 0 }}
              >
                {flashing ? (
                  <>
                    <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
                    {t('maint_marked_done')}
                  </>
                ) : (
                  <>
                    <Check size={14} strokeWidth={2} aria-hidden="true" />
                    {opensEntryForm ? t('maint_log_entry') : t('maint_mark_done')}
                  </>
                )}
              </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
