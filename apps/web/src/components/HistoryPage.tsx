import { useState, useMemo } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import type { Action, Product } from '../types'
import {
  getWaterStatus,
  getPhStatus,
  getChlorineStatus,
  getTacStatus,
  getTempStatus,
  extractMeasuredParams,
  translateLabel,
} from '../utils'
import { useT } from '../context/LocaleContext'
import { useInstallation } from '../context/InstallationContext'
import type { Locale, TranslationKey } from '../i18n/translations'
import { ACTION_TYPE_LABELS, PRODUCT_LABELS } from './ActionForm'

// ── Types ──────────────────────────────────────────────────────────────────

type FilterType = 'all' | 'measurement' | 'treatment' | 'maintenance'
type Category = 'measurement' | 'treatment' | 'maintenance'

// ── Helpers ─────────────────────────────────────────────────────────────────

function monthLabel(yearMonth: string, locale: Locale): string {
  const [y, m] = yearMonth.split('-')
  const d = new Date(parseInt(y), parseInt(m) - 1, 1)
  return d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', { month: 'long', year: 'numeric' })
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function getCategory(action: Action): Category {
  const t = action.action_type
  if (t === 'Measurement' || t === 'pH Measurement') return 'measurement'
  if (t === 'Add product') return 'treatment'
  return 'maintenance'
}

function getTitle(action: Action, products: Product[], t: (key: TranslationKey) => string): string {
  if (action.action_type === 'Measurement' || action.action_type === 'pH Measurement') return t('action_type_measurement')
  if (action.action_type === 'Add product') {
    const p = products.find(p => p.id === action.product_id)
    if (p) return translateLabel(t, PRODUCT_LABELS, p.name)
    return t('action_type_add_product')
  }
  return translateLabel(t, ACTION_TYPE_LABELS, action.action_type)
}

const CATEGORY_ICON: Record<Category, { emoji: string; bg: string }> = {
  measurement: { emoji: '🧪', bg: '#eef2ff' },
  treatment:   { emoji: '🧴', bg: '#f3e8ff' },
  maintenance: { emoji: '🔧', bg: '#e0f2fe' },
}

const PARAM_STATUS_STYLE: Record<'normal' | 'warn' | 'bad', { color: string; bg: string }> = {
  normal: { color: 'var(--status-ok-text)',     bg: 'var(--status-ok-bg)'     },
  warn:   { color: 'var(--status-warn-text)',   bg: 'var(--status-warn-bg)'   },
  bad:    { color: 'var(--status-danger-text)', bg: 'var(--status-danger-bg)' },
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Pill({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 10, fontWeight: 600,
      color, background: bg,
      padding: '2px 6px', borderRadius: 4,
      display: 'inline-block', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

function ParamPills({ action }: { action: Action }) {
  const { active, ranges } = useInstallation()
  const p = extractMeasuredParams([action])
  const pills: { label: string; status: 'normal' | 'warn' | 'bad' }[] = []

  if (p.ph !== null) {
    pills.push({ label: `pH ${p.ph.toFixed(1)}`, status: getPhStatus(p.ph, ranges ?? undefined) })
  }
  if (p.chlorine !== null) {
    pills.push({ label: `Cl ${p.chlorine.toFixed(1)} ${active?.conc_unit ?? 'mg/L'}`, status: getChlorineStatus(p.chlorine, ranges ?? undefined) })
  }
  if (p.tac !== null) {
    pills.push({ label: `TAC ${Math.round(p.tac)} ${active?.conc_unit ?? 'mg/L'}`, status: getTacStatus(p.tac, ranges ?? undefined) })
  }
  if (p.temp !== null) {
    pills.push({ label: `${p.temp.toFixed(1)} °${active?.temp_unit ?? 'C'}`, status: getTempStatus(p.temp, ranges ?? undefined) })
  }

  if (pills.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
      {pills.map(pill => {
        const { color, bg } = PARAM_STATUS_STYLE[pill.status]
        return <Pill key={pill.label} label={pill.label} color={color} bg={bg} />
      })}
    </div>
  )
}

function EntryCard({ action, products, onEdit, onDelete }: {
  action: Action
  products: Product[]
  onEdit?: (action: Action) => void
  onDelete?: (action: Action) => void
}) {
  const { t } = useT()
  const { ranges } = useInstallation()
  const [hovered, setHovered] = useState(false)
  const cat = getCategory(action)
  const title = getTitle(action, products, t)
  const { emoji, bg: iconBg } = CATEGORY_ICON[cat]

  const STATUS_CFG = {
    clear:  { label: t('status_normal'),     color: 'var(--status-ok-text)',     bg: 'var(--status-ok-bg)'     },
    cloudy: { label: t('status_watch'), color: 'var(--status-warn-text)',   bg: 'var(--status-warn-bg)'   },
    green:  { label: t('status_out_of_range'), color: 'var(--status-danger-text)', bg: 'var(--status-danger-bg)' },
  }

  const TYPE_PILL: Record<'treatment' | 'maintenance', { label: string; color: string; bg: string }> = {
    treatment: { label: t('history_treatment_badge'), color: 'var(--badge-purple-text)', bg: 'var(--badge-purple-bg)' },
    maintenance: { label: t('history_maintenance_badge'),  color: 'var(--badge-blue-text)',   bg: 'var(--badge-blue-bg)'   },
  }

  // Status badge (measurement) or type pill (treatment/maintenance)
  let badge: React.ReactNode = null
  if (cat === 'measurement') {
    const p = extractMeasuredParams([action])
    const { status, hasData } = getWaterStatus({ ph: p.ph, chlorine: p.chlorine, tac: p.tac }, ranges ?? undefined)
    if (hasData) {
      const c = STATUS_CFG[status]
      badge = <Pill label={c.label} color={c.color} bg={c.bg} />
    }
  } else {
    const c = TYPE_PILL[cat]
    badge = <Pill label={c.label} color={c.color} bg={c.bg} />
  }

  const noteText = cat === 'measurement'
    ? action.notes
      .replace(/chlorine?\s*(?:free)?\s*:\s*[\d.]+\.?\s*/gi, '')
      .replace(/TAC\s*:\s*[\d.]+\.?\s*/gi, '')
      .replace(/temperature?\s*:\s*[\d.]+\.?\s*/gi, '')
      .replace(/bromine\s*(?:total)?\s*:\s*[\d.]+\.?\s*/gi, '')
      .replace(/hardness\s*(?:total)?\s*:\s*[\d.]+\.?\s*/gi, '')
      .replace(/salt\s*:\s*[\d.]+\.?\s*/gi, '')
      .replace(/stabilizer\s*:\s*[\d.]+\.?\s*/gi, '')
      .replace(/combined\s*:\s*[\d.]+\.?\s*/gi, '')
      .replace(/^[\s.]+/, '')
      .trim()
    : action.notes.trim()

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 9,
        padding: '11px 14px',
        marginBottom: 6,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      {/* Icon */}
      <div style={{
        width: 34, height: 34, borderRadius: 8,
        background: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, flexShrink: 0, marginTop: 1,
      }}>
        {emoji}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Line 1: title + badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: '"Sora", sans-serif',
            fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
          }}>
            {title}
          </span>
          {badge}
        </div>

        {/* Line 2: note */}
        {noteText ? (
          <div style={{
            fontFamily: '"Sora", sans-serif',
            fontSize: 11, color: 'var(--text-muted)',
            marginTop: 3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {noteText}
          </div>
        ) : null}

        {/* Line 3: param pills (measurements only) */}
        {cat === 'measurement' && <ParamPills action={action} />}
      </div>

      {/* Date + actions */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0, alignSelf: 'center' }}>
        <div style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 10, color: 'var(--text-muted)',
        }}>
          {formatDate(action.date)}
        </div>
        <div style={{ display: 'flex', gap: 2, opacity: hovered ? 1 : 0, transition: 'opacity 0.15s' }}>
          {onEdit && (
            <button
              onClick={() => onEdit(action)}
              title={t('modal_edit')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
            >
              <Pencil size={13} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(action)}
              title={t('modal_delete')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

type Props = {
  actions: Action[]
  products: Product[]
  onEdit?: (action: Action) => void
  onDelete?: (action: Action) => void
}

export default function HistoryPage({ actions, products, onEdit, onDelete }: Props) {
  const { t, locale } = useT()
  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')

  const FILTER_BTNS: { label: string; value: FilterType }[] = [
    { label: t('history_all'),         value: 'all' },
    { label: t('history_measurements'),      value: 'measurement' },
    { label: t('history_treatments'),  value: 'treatment' },
    { label: t('history_maintenance'),   value: 'maintenance' },
  ]

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...actions]
      .filter(a => {
        if (filter !== 'all' && getCategory(a) !== filter) return false
        if (q) {
          const title = getTitle(a, products, t).toLowerCase()
          const note = a.notes.toLowerCase()
          if (!title.includes(q) && !note.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [actions, products, filter, search, t])

  const grouped = useMemo(() => {
    const map = new Map<string, Action[]>()
    for (const a of filtered) {
      const ym = a.date.slice(0, 7)
      if (!map.has(ym)) map.set(ym, [])
      map.get(ym)!.push(a)
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([ym, list]) => ({ ym, list }))
  }, [filtered])

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('page_history_title')}
        </div>
        <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {t('page_history_sub')}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        {/* Type filters */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTER_BTNS.map(btn => {
            const active = btn.value === filter
            return (
              <button
                key={btn.value}
                onClick={() => setFilter(btn.value)}
                style={{
                  fontFamily: '"Sora", sans-serif',
                  fontSize: 12, fontWeight: 500,
                  padding: '5px 12px', borderRadius: 7,
                  border: '1px solid var(--border)', cursor: 'pointer',
                  background: active ? 'var(--text-primary)' : 'var(--bg-surface)',
                  color: active ? 'var(--bg-surface)' : 'var(--text-muted)',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {btn.label}
              </button>
            )
          })}
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('history_search')}
          style={{
            fontFamily: '"Sora", sans-serif',
            fontSize: 11, color: 'var(--text-primary)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 10px',
            width: 160,
            outline: 'none',
          }}
        />
      </div>

      {/* Timeline */}
      {grouped.length === 0 ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 120,
          fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-muted)',
        }}>
          {t('history_no_entries')}
        </div>
      ) : (
        grouped.map(({ ym, list }) => (
          <div key={ym} style={{ marginBottom: 20 }}>
            {/* Month separator */}
            <div style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 10, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: 'var(--text-muted)',
              marginBottom: 8,
            }}>
              {monthLabel(ym, locale)}
            </div>
            {list.map(action => (
              <EntryCard key={action.id} action={action} products={products} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </div>
        ))
      )}
    </div>
  )
}
