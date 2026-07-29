import { useState, useMemo, useEffect } from 'react'
import { Pencil, Trash2, FlaskConical, Droplets, Wrench, Search } from 'lucide-react'
import type { Action, Product, TreatmentProduct } from '../types'
import {
  getWaterStatus,
  getPhStatus,
  getChlorineStatus,
  getTacStatus,
  getTempStatus,
  extractMeasuredParams,
  translateLabel,
  treatmentProductLabel,
  PRODUCT_ACTION_TYPE,
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

function getTitle(
  action: Action,
  products: Product[],
  treatments: TreatmentProduct[],
  t: (key: TranslationKey) => string,
): string {
  if (action.action_type === 'Measurement' || action.action_type === 'pH Measurement') return t('action_type_measurement')
  if (action.action_type === PRODUCT_ACTION_TYPE) {
    // The live catalog first, so renaming a product carries through history.
    const current = treatments.find(p => p.id === action.treatment_id)
    if (current) return treatmentProductLabel(current, t)
    // Then the label snapshotted when the entry was logged, which is all that
    // survives once the product is deleted.
    if (action.treatment_label) return action.treatment_label
    // Then the global product table, for entries predating the catalog.
    const legacy = products.find(p => p.id === action.product_id)
    if (legacy) return translateLabel(t, PRODUCT_LABELS, legacy.name)
    return t('action_type_add_product')
  }
  return translateLabel(t, ACTION_TYPE_LABELS, action.action_type)
}

/** The amount and brand a treatment carries, e.g. "250 g · HTH Super". */
function treatmentDetail(action: Action): string {
  return [[action.qty, action.unit].filter(Boolean).join(' '), action.brand]
    .filter(Boolean)
    .join(' · ')
}

// Accent is reserved for measurements; treatments and maintenance are told
// apart by their icon, not their colour.
const CATEGORY_ICON: Record<Category, { Icon: typeof FlaskConical; bg: string; color: string }> = {
  measurement: { Icon: FlaskConical, bg: 'var(--badge-accent-bg)',  color: 'var(--badge-accent-text)'  },
  treatment:   { Icon: Droplets,     bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-text)' },
  maintenance: { Icon: Wrench,       bg: 'var(--badge-neutral-bg)', color: 'var(--badge-neutral-text)' },
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

function EntryCard({ action, products, treatments, onEdit, onDelete }: {
  action: Action
  products: Product[]
  treatments: TreatmentProduct[]
  onEdit?: (action: Action) => void
  onDelete?: (action: Action) => void
}) {
  const { t } = useT()
  const { ranges } = useInstallation()
  const [hovered, setHovered] = useState(false)
  const cat = getCategory(action)
  const title = getTitle(action, products, treatments, t)
  const detail = cat === 'treatment' ? treatmentDetail(action) : ''
  const { Icon, bg: iconBg, color: iconColor } = CATEGORY_ICON[cat]

  const STATUS_CFG = {
    clear:  { label: t('status_normal'),     color: 'var(--status-ok-text)',     bg: 'var(--status-ok-bg)'     },
    cloudy: { label: t('status_watch'), color: 'var(--status-warn-text)',   bg: 'var(--status-warn-bg)'   },
    green:  { label: t('status_out_of_range'), color: 'var(--status-danger-text)', bg: 'var(--status-danger-bg)' },
  }

  const TYPE_PILL: Record<'treatment' | 'maintenance', { label: string; color: string; bg: string }> = {
    treatment: { label: t('history_treatment_badge'), color: 'var(--badge-neutral-text)', bg: 'var(--badge-neutral-bg)' },
    maintenance: { label: t('history_maintenance_badge'),  color: 'var(--badge-neutral-text)',   bg: 'var(--badge-neutral-bg)'   },
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
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-card)',
        padding: '12px 14px',
        marginBottom: 6,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      {/* Icon */}
      <div style={{
        width: 32, height: 32, borderRadius: 'var(--radius-sm)',
        background: iconBg, color: iconColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, marginTop: 1,
      }}>
        <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
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
          {detail && (
            <span style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 11, color: 'var(--text-secondary)',
            }}>
              {detail}
            </span>
          )}
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
        <div className="row-actions" style={{ display: 'flex', gap: 2, opacity: hovered ? 1 : 0, transition: 'opacity 0.15s' }}>
          {onEdit && (
            <button
              onClick={() => onEdit(action)}
              title={t('modal_edit')}
              aria-label={t('modal_edit')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
            >
              <Pencil size={14} strokeWidth={1.75} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(action)}
              title={t('modal_delete')}
              aria-label={t('modal_delete')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
            >
              <Trash2 size={14} strokeWidth={1.75} />
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
  const { active } = useInstallation()
  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')

  // The treatment catalog resolves a treatment's title, so renaming a product
  // reads through to every entry logged with it. A failed load degrades to the
  // snapshotted label rather than blanking the list.
  const [treatments, setTreatments] = useState<TreatmentProduct[]>([])
  useEffect(() => {
    if (!active) return
    let cancelled = false
    fetch(`/api/installations/${active.id}/treatments`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : []))
      .then((data: TreatmentProduct[]) => { if (!cancelled) setTreatments(Array.isArray(data) ? data : []) })
      .catch(() => { /* snapshotted labels still render */ })
    return () => { cancelled = true }
  }, [active?.id])

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
          const title = getTitle(a, products, treatments, t).toLowerCase()
          const note = a.notes.toLowerCase()
          const brand = (a.brand ?? '').toLowerCase()
          if (!title.includes(q) && !note.includes(q) && !brand.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [actions, products, treatments, filter, search, t])

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
      <div className="page-header">
        <div>
          <h1 className="page-header-title">{t('page_history_title')}</h1>
          <div className="page-header-sub">{t('page_history_sub')}</div>
        </div>
        <div className="page-header-actions">
          <div className="segmented">
            {FILTER_BTNS.map(btn => (
              <button
                key={btn.value}
                className={btn.value === filter ? 'active' : ''}
                onClick={() => setFilter(btn.value)}
              >
                {btn.label}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={13} strokeWidth={1.75} aria-hidden="true" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('history_search')}
              style={{
                fontFamily: '"Sora", sans-serif',
                fontSize: 12, color: 'var(--text-primary)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px 6px 26px',
                width: 160,
                outline: 'none',
              }}
            />
          </div>
        </div>
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
              <EntryCard key={action.id} action={action} products={products} treatments={treatments} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </div>
        ))
      )}
    </div>
  )
}
