import { useEffect, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Installation, TreatmentProduct } from '../types'
import { TREATMENT_UNITS, treatmentProductLabel } from '../utils'
import { DEFAULT_TREATMENT_ICON, TREATMENT_ICON_CHOICES, TaskIcon } from '../taskIcons'
import { useT } from '../context/LocaleContext'
import type { TranslationKey } from '../i18n/translations'

// A row in the editable draft, mirroring MaintenanceConfig: existing products
// keep their real `id`, freshly added ones get a negative temp id and `isNew`,
// and `deleted` tombstones a row until Save persists it.
//
// Every row is editable the same way — there is no built-in/custom distinction.
// `label` holds what the user sees, which for a never-renamed seeded product is
// its translation; `initialLabel` is that same string as loaded, so Save can
// tell an actual rename from "the user just left the translation alone".
type DraftProduct = {
  id: number
  label: string
  initialLabel: string
  icon: string
  default_unit: string
  param: string | null
  isNew: boolean
  enabled: boolean
  deleted: boolean
}

/** The parameters a product can be tagged as moving. Kept to the ones with a
 * real dosing story — `cc` and `temp` have no product to add. */
const PARAM_CHOICES: { value: string; labelKey: TranslationKey }[] = [
  { value: 'ph', labelKey: 'param_ph' },
  { value: 'cl', labelKey: 'param_chlorine' },
  { value: 'br', labelKey: 'param_bromine' },
  { value: 'tac', labelKey: 'param_tac' },
  { value: 'hardness', labelKey: 'param_hardness' },
  { value: 'cya', labelKey: 'param_stabilizer' },
  { value: 'salt', labelKey: 'param_salt' },
]

const NO_PARAM = 'none'

type Props = {
  installation: Installation
  onSaved?: () => void
}

let tempIdSeq = -1

/** Icon chooser. The mdi name is shown next to each choice on purpose: it is
 * what the product's Home Assistant entry will carry. */
function IconPicker({
  value, onChange, label,
}: { value: string; onChange: (icon: string) => void; label: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} title={label} className="w-auto px-2 gap-1 shrink-0">
        <TaskIcon name={value} />
      </SelectTrigger>
      <SelectContent>
        {TREATMENT_ICON_CHOICES.map(name => (
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

export default function TreatmentConfig({ installation, onSaved }: Props) {
  const { t } = useT()
  const [draft, setDraft] = useState<DraftProduct[]>([])
  const [original, setOriginal] = useState<Record<number, TreatmentProduct>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newUnit, setNewUnit] = useState(TREATMENT_UNITS[0])
  const [newIcon, setNewIcon] = useState(DEFAULT_TREATMENT_ICON)

  useEffect(() => {
    setLoading(true)
    setLoadError(false)
    setSaveError(false)
    fetch(`/api/installations/${installation.id}/treatments`, { credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error('failed'); return r.json() })
      .then((data: TreatmentProduct[]) => {
        setOriginal(Object.fromEntries(data.map(p => [p.id, p])))
        setDraft(data.map(p => {
          const label = treatmentProductLabel(p, t)
          return {
            id: p.id,
            label,
            initialLabel: label,
            icon: p.icon,
            default_unit: p.default_unit,
            param: p.param,
            enabled: p.enabled,
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
  }, [installation.id])

  const patchRow = (id: number, patch: Partial<DraftProduct>) => {
    setDraft(prev => prev.map(row => row.id === id ? { ...row, ...patch } : row))
  }

  const addCustom = () => {
    const label = newLabel.trim()
    if (!label) return
    setDraft(prev => [...prev, {
      id: tempIdSeq--,
      label,
      initialLabel: label,
      icon: newIcon,
      default_unit: newUnit,
      param: null,
      enabled: true,
      isNew: true,
      deleted: false,
    }])
    setNewLabel('')
    setNewUnit(TREATMENT_UNITS[0])
    setNewIcon(DEFAULT_TREATMENT_ICON)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(false)
    try {
      const base = `/api/installations/${installation.id}/treatments`
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
              icon: row.icon,
              default_unit: row.default_unit,
              param: row.param,
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
        if (orig.icon !== row.icon) patch.icon = row.icon
        if (orig.default_unit !== row.default_unit) patch.default_unit = row.default_unit
        if (orig.param !== row.param) patch.param = row.param
        // Only a real rename is sent: leaving a seeded product's translated label
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
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  const rows = draft.filter(row => !row.deleted)

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 0', borderBottom: '1px solid var(--border)',
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
        {t('treat_config_sub')}
      </p>
      <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
        {t('treat_config_hint')}
      </p>

      {loading && (
        <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-secondary)' }}>{t('treat_loading')}</p>
      )}
      {loadError && (
        <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)' }}>{t('treat_load_error')}</p>
      )}

      {!loading && !loadError && (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {rows.map(row => (
            <div key={row.id} style={rowStyle}>
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={e => patchRow(row.id, { enabled: e.target.checked })}
                aria-label={t('treat_enabled_label')}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)', flexShrink: 0, cursor: 'pointer' }}
              />

              <IconPicker
                value={row.icon}
                onChange={icon => patchRow(row.id, { icon })}
                label={t('treat_icon_label')}
              />

              <Input
                value={row.label}
                onChange={e => patchRow(row.id, { label: e.target.value })}
                aria-label={t('treat_product_name')}
                style={{ flex: 1, minWidth: 0, opacity: row.enabled ? 1 : 0.5 }}
              />

              <Select
                value={row.default_unit}
                onValueChange={v => patchRow(row.id, { default_unit: v })}
              >
                <SelectTrigger aria-label={t('treat_unit_label')} className="w-auto px-2 gap-1 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TREATMENT_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select
                value={row.param ?? NO_PARAM}
                onValueChange={v => patchRow(row.id, { param: v === NO_PARAM ? null : v })}
              >
                <SelectTrigger aria-label={t('treat_param_label')} className="w-auto px-2 gap-1 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARAM}>{t('treat_param_none')}</SelectItem>
                  {PARAM_CHOICES.map(p => (
                    <SelectItem key={p.value} value={p.value}>{t(p.labelKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <button
                type="button"
                onClick={() => patchRow(row.id, { deleted: true })}
                aria-label={t('treat_delete')}
                title={t('treat_delete')}
                style={{
                  flexShrink: 0, width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ))}

          {/* Add a product */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12 }}>
            <IconPicker
              value={newIcon}
              onChange={setNewIcon}
              label={t('treat_icon_label')}
            />
            <Input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
              placeholder={t('treat_product_name_placeholder')}
              aria-label={t('treat_product_name')}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Select value={newUnit} onValueChange={setNewUnit}>
              <SelectTrigger aria-label={t('treat_unit_label')} className="w-auto px-2 gap-1 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TREATMENT_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={addCustom} disabled={!newLabel.trim()}>
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              {t('treat_add')}
            </Button>
          </div>
        </div>
      )}

      {saveError && (
        <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)', margin: '8px 0 0' }}>
          {t('treat_save_error')}
        </p>
      )}

      <Button type="button" onClick={handleSave} disabled={saving || loading} className="w-full" style={{ marginTop: 12, flexShrink: 0 }}>
        {saving ? t('treat_saving') : t('treat_save')}
      </Button>
    </div>
  )
}
