import { useState, useMemo, useEffect } from 'react'
import { Pencil, Trash2, Plus, Download, Upload, FlaskConical, Wrench, AlertTriangle, ChevronRight, Droplets, Check } from 'lucide-react'
import type { Action, Product, RecommendationsResponse, MaintenanceTask } from '../types'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import type { Locale } from '../i18n/translations'
import TrendChart from './TrendChart'
import {
  PARAM_RANGES,
  extractMeasuredParams,
  getPhStatus,
  getChlorineStatus,
  getBromineStatus,
  getSaltStatus,
  getTacStatus,
  getTempStatus,
  getStabilizerStatus,
  getHardnessStatus,
  getParamHistory,
  getDaysSince,
  getChemistryTodoItems,
  maintenanceTodoItems,
  translateLabel,
  type TodoItem,
  type ParamStatus,
  type HistoryParamKey,
  type DynamicRanges,
} from '../utils'
import { ACTION_TYPE_LABELS } from './ActionForm'

function formatDateLong(d: Date, locale: Locale): string {
  return d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function formatShortDate(dateStr: string): string {
  const [, m, day] = dateStr.split('-')
  return `${day}/${m}`
}

function statusColor(s: ParamStatus): string {
  if (s === 'normal') return 'var(--status-ok-text)'
  if (s === 'warn') return 'var(--status-warn-text)'
  return 'var(--status-danger-text)'
}

type Props = {
  actions: Action[]
  products: Product[]
  onEdit: (action: Action) => void
  onDelete: (action: Action) => void
  onExport?: () => void
  onImport?: (file: File) => Promise<void>
  onNavigate?: (page: 'measurements' | 'history' | 'recommendations' | 'maintenance') => void
  onAdd?: () => void
}

type TileDef = {
  key: string
  label: string
  value: string
  unit: string
  status: ParamStatus | null
  historyKey: HistoryParamKey
  range: { ideal: [number, number]; acceptable: [number, number] }
  format: (v: number) => string
}

export default function DashboardPage({ actions, products: _products, onEdit, onDelete, onExport, onImport, onNavigate, onAdd }: Props) {
  const { active, ranges } = useInstallation()
  const { t, locale } = useT()
  const sanitizer = active?.sanitizer ?? 'chlorine'

  const today = new Date()

  const params = useMemo(() => extractMeasuredParams(actions), [actions])
  const phHistory = useMemo(() => getParamHistory(actions, 'ph', 12), [actions])

  const [maintenanceTasks, setMaintenanceTasks] = useState<MaintenanceTask[]>([])
  useEffect(() => {
    if (!active) return
    fetch(`/api/installations/${active.id}/maintenance`, { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then((data: MaintenanceTask[] | null) => setMaintenanceTasks(data ?? []))
      .catch(() => setMaintenanceTasks([]))
    // Refetch when the action log changes so completed maintenance clears its
    // due status here too.
  }, [active?.id, actions])

  const todoItems = useMemo<TodoItem[]>(
    () => [...maintenanceTodoItems(maintenanceTasks, t), ...getChemistryTodoItems(params, t)],
    [maintenanceTasks, params, t],
  )

  const [recommendationsCount, setRecommendationsCount] = useState<number | null>(null)
  useEffect(() => {
    if (!active) return
    fetch(`/api/installations/${active.id}/recommendations`, { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then((data: RecommendationsResponse | null) => setRecommendationsCount(data?.recommendations.length ?? null))
      .catch(() => setRecommendationsCount(null))
  }, [active?.id])

  const [hoveredRowId, setHoveredRowId] = useState<number | null>(null)

  const recentActions = useMemo(() =>
    [...actions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
  , [actions])

  const lastMeasuredLabel = useMemo(() => {
    if (!params.date) return null
    const days = getDaysSince(params.date)
    if (days === 0) return t('kpi_today').toLowerCase()
    if (days === 1) return t('kpi_yesterday').toLowerCase()
    const prefix = t('kpi_ago')
    return prefix ? `${prefix.toLowerCase()} ${days} ${t('kpi_day_abbr')}` : `${days} ${t('kpi_day_abbr')}`
  }, [params.date, t])

  // ── Param tiles ───────────────────────────────────────────────────────────
  const tiles = useMemo<TileDef[]>(() => {
    const r = (key: keyof typeof PARAM_RANGES) => (ranges as DynamicRanges | null)?.[key] ?? PARAM_RANGES[key]
    const concUnit = active?.conc_unit ?? 'mg/L'
    const defs: TileDef[] = []

    defs.push({
      key: 'ph', label: t('param_ph'),
      value: params.ph !== null ? params.ph.toFixed(1) : '—', unit: '',
      status: params.ph !== null ? getPhStatus(params.ph, ranges ?? undefined) : null,
      historyKey: 'ph', range: r('ph'), format: v => v.toFixed(1),
    })
    if (sanitizer === 'bromine') {
      defs.push({
        key: 'bromine', label: t('param_bromine'),
        value: params.bromine !== null ? params.bromine.toFixed(1) : '—', unit: concUnit,
        status: params.bromine !== null ? getBromineStatus(params.bromine, ranges ?? undefined) : null,
        historyKey: 'bromine', range: r('bromine'), format: v => v.toFixed(1),
      })
    } else if (sanitizer === 'salt') {
      defs.push({
        key: 'salt', label: t('param_salt'),
        value: params.salt !== null ? params.salt.toFixed(0) : '—', unit: active?.salt_unit ?? 'ppm',
        status: params.salt !== null ? getSaltStatus(params.salt, ranges ?? undefined) : null,
        historyKey: 'salt', range: r('salt'), format: v => v.toFixed(0),
      })
      defs.push({
        key: 'chlorine', label: t('param_chlorine'),
        value: params.chlorine !== null ? params.chlorine.toFixed(1) : '—', unit: concUnit,
        status: params.chlorine !== null ? getChlorineStatus(params.chlorine, ranges ?? undefined) : null,
        historyKey: 'chlorine', range: r('chlorine'), format: v => v.toFixed(1),
      })
    } else {
      defs.push({
        key: 'chlorine', label: t('param_chlorine'),
        value: params.chlorine !== null ? params.chlorine.toFixed(1) : '—', unit: concUnit,
        status: params.chlorine !== null ? getChlorineStatus(params.chlorine, ranges ?? undefined) : null,
        historyKey: 'chlorine', range: r('chlorine'), format: v => v.toFixed(1),
      })
    }
    defs.push({
      key: 'tac', label: t('param_tac'),
      value: params.tac !== null ? String(Math.round(params.tac)) : '—', unit: concUnit,
      status: params.tac !== null ? getTacStatus(params.tac, ranges ?? undefined) : null,
      historyKey: 'tac', range: r('tac'), format: v => String(Math.round(v)),
    })
    defs.push({
      key: 'temp', label: t('param_temp_label'),
      value: params.temp !== null ? params.temp.toFixed(1) : '—', unit: `°${active?.temp_unit ?? 'C'}`,
      status: params.temp !== null ? getTempStatus(params.temp, ranges ?? undefined) : null,
      historyKey: 'temp', range: r('temp'), format: v => v.toFixed(1),
    })
    if (ranges?.stabilizer) {
      defs.push({
        key: 'stabilizer', label: t('guidance_cya_label'),
        value: params.stabilizer !== null ? String(Math.round(params.stabilizer)) : '—', unit: 'ppm',
        status: params.stabilizer !== null ? getStabilizerStatus(params.stabilizer, ranges ?? undefined) : null,
        historyKey: 'stabilizer', range: r('stabilizer'), format: v => String(Math.round(v)),
      })
    }
    if (ranges?.hardness) {
      defs.push({
        key: 'hardness', label: t('param_hardness'),
        value: params.hardness !== null ? String(Math.round(params.hardness)) : '—', unit: active?.hardness_unit ?? 'ppm',
        status: params.hardness !== null ? getHardnessStatus(params.hardness, ranges ?? undefined) : null,
        historyKey: 'hardness', range: r('hardness'), format: v => String(Math.round(v)),
      })
    }
    return defs
  }, [params, ranges, sanitizer, active, t])

  const phRange = (ranges as DynamicRanges | null)?.ph ?? PARAM_RANGES.ph

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-header-title" style={{ margin: 0 }}>{t('page_log_title')}</h1>
          <div className="page-header-sub">
            {active?.name ? `${active.name} · ` : ''}{formatDateLong(today, locale)}
            {lastMeasuredLabel ? ` · ${t('dash_last_measured').toLowerCase()} ${lastMeasuredLabel}` : ''}
          </div>
        </div>
        <div className="page-header-actions">
          {onExport && (
            <button className="btn-ghost" onClick={onExport} title={t('export_label')} aria-label={t('export_label')} style={{ padding: '7px 9px' }}>
              <Download size={15} strokeWidth={1.75} />
            </button>
          )}
          {onImport && (
            <label className="btn-ghost" title={t('import_label')} aria-label={t('import_label')} style={{ padding: '7px 9px' }}>
              <Upload size={15} strokeWidth={1.75} />
              <input
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) { onImport(file); e.target.value = '' }
                }}
              />
            </label>
          )}
          {onAdd && (
            <button className="btn-primary" onClick={onAdd}>
              <Plus size={15} strokeWidth={2} />
              {t('nav_new_entry_aria')}
            </button>
          )}
        </div>
      </div>

      {actions.length === 0 ? (
        /* ── Empty state ─────────────────────────────────────────────────── */
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <Droplets size={28} strokeWidth={1.5} style={{ color: 'var(--accent)', marginBottom: 12 }} aria-hidden="true" />
          <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
            {t('dash_empty_title')}
          </div>
          <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-secondary)', margin: '6px auto 20px', maxWidth: 340 }}>
            {t('dash_empty_sub')}
          </p>
          {onAdd && (
            <button className="btn-primary" onClick={onAdd}>
              <Plus size={15} strokeWidth={2} />
              {t('dash_log_first')}
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ── Water status board ──────────────────────────────────────────── */}
          <div className="param-tile-grid">
            {tiles.map(tile => (
              <ParamTile key={tile.key} tile={tile} actions={actions} onClick={() => onNavigate?.('measurements')} />
            ))}
          </div>

          {/* ── Attention + trend ───────────────────────────────────────────── */}
          <div className="dashboard-columns">
            <AttentionPanel
              todoItems={todoItems}
              recommendationsCount={recommendationsCount}
              onNavigate={onNavigate}
            />

            <div className="card" style={{ padding: 16 }}>
              <div className="section-title" style={{ marginBottom: 8 }}>{t('graph_ph_trend')}</div>
              <TrendChart
                points={phHistory}
                idealMin={phRange.ideal[0]}
                idealMax={phRange.ideal[1]}
                acceptableMin={phRange.acceptable[0]}
                acceptableMax={phRange.acceptable[1]}
                height={150}
                formatValue={v => v.toFixed(1)}
                emptyLabel={t('graph_not_enough_data')}
              />
            </div>
          </div>

          {/* ── Recent activity ─────────────────────────────────────────────── */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="section-title" style={{ margin: 0 }}>{t('table_recent_history')}</div>
              <button
                onClick={() => onNavigate?.('history')}
                style={{
                  fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: 'var(--accent)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  display: 'inline-flex', alignItems: 'center', gap: 2,
                }}
              >
                {t('kpi_see_all').replace(' →', '')}
                <ChevronRight size={12} strokeWidth={2} />
              </button>
            </div>

            <table className="history-table" style={{ marginBottom: 0 }}>
              <thead>
                <tr>
                  <th>{t('table_date')}</th>
                  <th>{t('table_type')}</th>
                  <th className="history-col-params">{t('table_parameters')}</th>
                  <th className="history-col-notes">{t('table_notes')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recentActions.map(action => (
                  <tr
                    key={action.id}
                    onMouseEnter={() => setHoveredRowId(action.id)}
                    onMouseLeave={() => setHoveredRowId(null)}
                  >
                    <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {formatShortDate(action.date)}
                    </td>
                    <td>
                      <ActionTypeBadge actionType={action.action_type} />
                    </td>
                    <td className="history-col-params">
                      <ActionParamPills action={action} />
                    </td>
                    <td className="history-col-notes" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {action.notes || '—'}
                    </td>
                    <td style={{ width: 56 }}>
                      <div className="row-actions" style={{ display: 'flex', gap: 2, opacity: hoveredRowId === action.id ? 1 : 0, transition: 'opacity 0.15s' }}>
                        <button
                          onClick={() => onEdit(action)}
                          title={t('modal_edit')}
                          aria-label={t('modal_edit')}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                        >
                          <Pencil size={14} strokeWidth={1.75} />
                        </button>
                        <button
                          onClick={() => onDelete(action)}
                          title={t('modal_delete')}
                          aria-label={t('modal_delete')}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                        >
                          <Trash2 size={14} strokeWidth={1.75} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ParamTile({ tile, actions, onClick }: { tile: TileDef; actions: Action[]; onClick: () => void }) {
  const { t } = useT()
  const hasData = tile.value !== '—'
  const history = useMemo(
    () => getParamHistory(actions, tile.historyKey, 10),
    [actions, tile.historyKey],
  )
  const rail = tile.status !== null ? statusColor(tile.status) : 'var(--border)'
  return (
    <button
      className="param-tile"
      onClick={onClick}
      style={{ '--tile-rail': rail, opacity: hasData ? 1 : 0.6 } as React.CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tile.label}
        </span>
        {tile.status !== null && (
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: rail, flexShrink: 0 }} />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '6px 0 2px' }}>
        <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.1 }}>
          {tile.value}
        </span>
        {tile.unit && hasData && (
          <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: 'var(--text-muted)' }}>{tile.unit}</span>
        )}
      </div>
      <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, color: 'var(--text-muted)' }}>
        {t('param_ideal_label')} {tile.format(tile.range.ideal[0])}–{tile.format(tile.range.ideal[1])}
      </div>
      {history.length >= 2 && (
        <div style={{ marginTop: 8 }}>
          <TrendChart
            points={history}
            idealMin={tile.range.ideal[0]}
            idealMax={tile.range.ideal[1]}
            acceptableMin={tile.range.acceptable[0]}
            acceptableMax={tile.range.acceptable[1]}
            compact
          />
        </div>
      )}
    </button>
  )
}

function AttentionPanel({
  todoItems,
  recommendationsCount,
  onNavigate,
}: {
  todoItems: TodoItem[]
  recommendationsCount: number | null
  onNavigate?: (page: 'measurements' | 'history' | 'recommendations' | 'maintenance') => void
}) {
  const { t } = useT()
  const KIND_ICON = {
    measure: FlaskConical,
    maintenance: Wrench,
    chemistry: AlertTriangle,
  } as const

  const isEmpty = todoItems.length === 0 && (recommendationsCount === null || recommendationsCount === 0)

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="section-title" style={{ marginBottom: 12 }}>{t('attention_title')}</div>

      {isEmpty ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--status-ok-text)', fontFamily: '"Sora", sans-serif', fontSize: 13, padding: '8px 0' }}>
          <Check size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('attention_all_ok')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {todoItems.map(item => {
            const Icon = KIND_ICON[item.kind]
            const color = item.isOverdue ? 'var(--status-danger-text)' : 'var(--status-warn-text)'
            const bg = item.isOverdue ? 'var(--status-danger-bg)' : 'var(--status-warn-bg)'
            return (
              <button
                key={item.id}
                onClick={() => onNavigate?.(item.kind === 'chemistry' ? 'recommendations' : 'maintenance')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '8px 8px', margin: '0 -8px', borderRadius: 'var(--radius-sm)',
                  background: 'none', border: 'none', cursor: onNavigate ? 'pointer' : 'default',
                  textAlign: 'left', font: 'inherit', color: 'inherit',
                }}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: 'var(--radius-sm)', background: bg, color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {item.title}
                  </span>
                  <span style={{ display: 'block', fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.subtitle}
                  </span>
                </span>
                <span style={{
                  fontFamily: '"IBM Plex Mono", monospace', fontSize: 10,
                  color: item.isOverdue ? 'var(--status-danger-text)' : 'var(--text-muted)',
                  flexShrink: 0,
                }}>
                  {item.delay}
                </span>
              </button>
            )
          })}

          {recommendationsCount !== null && recommendationsCount > 0 && (
            <button
              onClick={() => onNavigate?.('recommendations')}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '8px 8px', margin: '0 -8px', borderRadius: 'var(--radius-sm)',
                background: 'none', border: 'none', cursor: onNavigate ? 'pointer' : 'default',
                textAlign: 'left', font: 'inherit', color: 'inherit',
              }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                background: 'var(--accent-dim)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <FlaskConical size={14} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span style={{ flex: 1, fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                {recommendationsCount} {t('recommendations_dashboard_teaser_count')}
              </span>
              <ChevronRight size={14} strokeWidth={1.75} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ActionTypeBadge({ actionType }: { actionType: string }) {
  const { t } = useT()
  let color = 'var(--badge-neutral-text)', bg = 'var(--badge-neutral-bg)'
  if (actionType === 'Measurement' || actionType === 'pH Measurement') {
    color = 'var(--badge-accent-text)'; bg = 'var(--badge-accent-bg)'
  }
  return (
    <span style={{
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 10, fontWeight: 600,
      color, background: bg,
      padding: '2px 6px', borderRadius: 4,
      display: 'inline-block', whiteSpace: 'nowrap',
    }}>
      {translateLabel(t, ACTION_TYPE_LABELS, actionType)}
    </span>
  )
}

function ActionParamPills({ action }: { action: Action }) {
  const { active, ranges } = useInstallation()
  const p = extractMeasuredParams([action])
  const pills: Array<{ label: string; color: string; bg: string }> = []
  const styleMap = {
    normal: { color: 'var(--status-ok-text)',     bg: 'var(--status-ok-bg)'     },
    warn:   { color: 'var(--status-warn-text)',   bg: 'var(--status-warn-bg)'   },
    bad:    { color: 'var(--status-danger-text)', bg: 'var(--status-danger-bg)' },
  }
  if (p.ph !== null) {
    const s = getPhStatus(p.ph, ranges ?? undefined)
    pills.push({ label: `pH ${p.ph.toFixed(1)}`, ...styleMap[s] })
  }
  if (p.chlorine !== null) {
    const s = getChlorineStatus(p.chlorine, ranges ?? undefined)
    pills.push({ label: `Cl ${p.chlorine.toFixed(1)} ${active?.conc_unit ?? 'mg/L'}`, ...styleMap[s] })
  }
  if (p.tac !== null) {
    const s = getTacStatus(p.tac, ranges ?? undefined)
    pills.push({ label: `TAC ${Math.round(p.tac)} ${active?.conc_unit ?? 'mg/L'}`, ...styleMap[s] })
  }
  if (p.temp !== null) {
    const s = getTempStatus(p.temp, ranges ?? undefined)
    pills.push({ label: `T° ${p.temp.toFixed(1)} °${active?.temp_unit ?? 'C'}`, ...styleMap[s] })
  }
  if (pills.length === 0) {
    return <span style={{ color: 'var(--text-muted)', fontFamily: '"IBM Plex Mono", monospace', fontSize: 10 }}>—</span>
  }
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {pills.map(pill => (
        <span key={pill.label} style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 10, fontWeight: 600,
          color: pill.color, background: pill.bg,
          padding: '2px 5px', borderRadius: 4,
          display: 'inline-block', whiteSpace: 'nowrap',
        }}>
          {pill.label}
        </span>
      ))}
    </div>
  )
}
