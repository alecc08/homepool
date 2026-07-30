import { useEffect, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import type { MaintenanceTask } from '../types'
import { maintenanceTaskLabel } from '../utils'
import { DEFAULT_TASK_ICON, TASK_ICON_CHOICES, TaskIcon } from '../taskIcons'
import { useT } from '../context/LocaleContext'

// A row in the editable draft. Existing tasks keep their real `id`; freshly
// added ones get a negative temp id and `isNew`. `deleted` tombstones a row
// until Save persists it.
//
// Every row is editable the same way — there is no built-in/custom distinction.
// `label` holds what the user sees, which for a never-renamed seeded task is its
// translation; `initialLabel` is that same string as loaded, so Save can tell an
// actual rename from "the user just left the translation alone".
type DraftTask = {
  id: number
  label: string
  initialLabel: string
  icon: string
  interval_days: number
  enabled: boolean
  isNew: boolean
  deleted: boolean
}

type Props = {
  installationId: number
  open: boolean
  onClose: () => void
  onSaved?: () => void
}

let tempIdSeq = -1

/** Icon chooser for a task. The mdi name is shown next to each choice on
 * purpose: it is what the task's Home Assistant sensor and button will use. */
function IconPicker({
  value, onChange, label,
}: { value: string; onChange: (icon: string) => void; label: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} title={label} className="w-auto px-2 gap-1 shrink-0">
        <TaskIcon name={value} />
      </SelectTrigger>
      <SelectContent>
        {TASK_ICON_CHOICES.map(name => (
          <SelectItem key={name} value={name}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <TaskIcon name={name} />
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-muted)' }}>
                {name}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default function MaintenanceConfig({ installationId, open, onClose, onSaved }: Props) {
  const { t } = useT()
  const [draft, setDraft] = useState<DraftTask[]>([])
  const [original, setOriginal] = useState<Record<number, MaintenanceTask>>({})
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newInterval, setNewInterval] = useState('7')
  const [newIcon, setNewIcon] = useState(DEFAULT_TASK_ICON)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setLoadError(false)
    setSaveError(false)
    setNewLabel('')
    setNewInterval('7')
    setNewIcon(DEFAULT_TASK_ICON)
    fetch(`/api/installations/${installationId}/maintenance`, { credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error('failed'); return r.json() })
      .then((data: MaintenanceTask[]) => {
        setOriginal(Object.fromEntries(data.map(tk => [tk.id, tk])))
        setDraft(data.map(tk => {
          const label = maintenanceTaskLabel(tk, t)
          return {
            id: tk.id,
            label,
            initialLabel: label,
            icon: tk.icon,
            interval_days: tk.interval_days,
            enabled: tk.enabled,
            isNew: false,
            deleted: false,
          }
        }))
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
    // `t` is stable per locale; re-running on a locale switch would clobber
    // pending edits, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, installationId])

  const patchRow = (id: number, patch: Partial<DraftTask>) => {
    setDraft(prev => prev.map(row => row.id === id ? { ...row, ...patch } : row))
  }

  const addCustom = () => {
    const label = newLabel.trim()
    const interval = parseInt(newInterval, 10)
    // 0 is allowed and means "on demand": the task can be logged from the entry
    // form, but never becomes due.
    if (!label || !Number.isFinite(interval) || interval < 0) return
    setDraft(prev => [...prev, {
      id: tempIdSeq--,
      label,
      initialLabel: label,
      icon: newIcon,
      interval_days: interval,
      enabled: true,
      isNew: true,
      deleted: false,
    }])
    setNewLabel('')
    setNewInterval('7')
    setNewIcon(DEFAULT_TASK_ICON)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(false)
    try {
      const base = `/api/installations/${installationId}/maintenance`
      const requests: Promise<Response>[] = []
      for (const row of draft) {
        if (row.isNew) {
          if (row.deleted) continue // added then removed before saving — no-op
          requests.push(fetch(base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              label: row.label,
              interval_days: row.interval_days,
              icon: row.icon,
            }),
          }))
          continue
        }
        if (row.deleted) {
          requests.push(fetch(`${base}/${row.id}`, { method: 'DELETE', credentials: 'same-origin' }))
          continue
        }
        const orig = original[row.id]
        const patch: Record<string, unknown> = {}
        if (orig.enabled !== row.enabled) patch.enabled = row.enabled
        if (orig.interval_days !== row.interval_days) patch.interval_days = row.interval_days
        if (orig.icon !== row.icon) patch.icon = row.icon
        // Only a real rename is sent: leaving a seeded task's translated label
        // untouched must not overwrite it with the current locale's string (which
        // would drop its builtin_key server-side and freeze the language).
        if (row.initialLabel !== row.label) patch.label = row.label
        if (Object.keys(patch).length > 0) {
          requests.push(fetch(`${base}/${row.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(patch),
          }))
        }
      }
      const results = await Promise.all(requests)
      if (results.some(r => !r.ok)) throw new Error('failed')
      onSaved?.()
      onClose()
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  const rows = draft.filter(row => !row.deleted)

  // Same wrapping rule as the treatment rows: the task name keeps a readable
  // floor and the interval/delete group drops below it when the dialog is narrow.
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10,
    padding: '10px 0', borderBottom: '1px solid var(--border)',
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: '"Sora", sans-serif', fontWeight: 600 }}>
            {t('maint_config_title')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0">
          <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
            {t('maint_config_sub')}
          </p>
          <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
            {t('maint_config_interval_hint')}
          </p>

          {loading && (
            <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-secondary)' }}>{t('ranges_loading')}</p>
          )}
          {loadError && (
            <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)' }}>{t('maint_load_error')}</p>
          )}

          {!loading && !loadError && (
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {rows.map(row => (
                <div key={row.id} style={rowStyle}>
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={e => patchRow(row.id, { enabled: e.target.checked })}
                    aria-label={t('maint_enabled_label')}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent)', flexShrink: 0, cursor: 'pointer' }}
                  />

                  <IconPicker
                    value={row.icon}
                    onChange={icon => patchRow(row.id, { icon })}
                    label={t('maint_icon_label')}
                  />

                  <Input
                    value={row.label}
                    onChange={e => patchRow(row.id, { label: e.target.value })}
                    aria-label={t('maint_task_name')}
                    style={{ flex: '1 1 150px', minWidth: 150, opacity: row.enabled ? 1 : 0.5 }}
                  />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Input
                        type="number"
                        min={0}
                        value={String(row.interval_days)}
                        onChange={e => patchRow(row.id, { interval_days: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                        aria-label={t('maint_interval_label')}
                        // Wide enough for a three-digit interval (a yearly task
                        // is 365) without the last digit crowding the border.
                        style={{ width: 72, opacity: row.enabled ? 1 : 0.5 }}
                      />
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-muted)' }}>
                        {t('todo_day_abbr')}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => patchRow(row.id, { deleted: true })}
                      aria-label={t('maint_delete')}
                      title={t('maint_delete')}
                      style={{
                        flexShrink: 0, width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                        background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Add a task */}
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 12 }}>
                <IconPicker
                  value={newIcon}
                  onChange={setNewIcon}
                  label={t('maint_icon_label')}
                />
                <Input
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
                  placeholder={t('maint_task_name_placeholder')}
                  aria-label={t('maint_task_name')}
                  style={{ flex: '1 1 150px', minWidth: 150 }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
                  <Input
                    type="number"
                    min={0}
                    value={newInterval}
                    onChange={e => setNewInterval(e.target.value)}
                    aria-label={t('maint_interval_label')}
                    style={{ width: 72 }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addCustom} disabled={!newLabel.trim()}>
                    <Plus size={14} strokeWidth={2} aria-hidden="true" />
                    {t('maint_add')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {saveError && (
            <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)', margin: '8px 0 0' }}>
              {t('maint_save_error')}
            </p>
          )}

          <Button type="button" onClick={handleSave} disabled={saving || loading} className="w-full" style={{ marginTop: 12, flexShrink: 0 }}>
            {saving ? t('maint_saving') : t('maint_save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
