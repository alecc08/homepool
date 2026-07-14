import { useState, useMemo } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import type { Action, Product } from '../types'
import WaterStatusCard from './WaterStatusCard'
import { useInstallation } from '../context/InstallationContext'
import { useTheme, type Theme } from '../hooks/useTheme'
import { useT } from '../context/LocaleContext'
import type { Locale } from '../i18n/translations'

function getIsDark(theme: Theme): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
import {
  extractMeasuredParams,
  getPhStatus,
  getChlorineStatus,
  getBromineStatus,
  getSaltStatus,
  getTacStatus,
  getTempStatus,
  getPhHistory,
  getActionsThisMonth,
  getActionsLastMonth,
  daysSinceLastAction,
  getNextMeasureInDays,
  getTreatmentsThisMonth,
  getTodoItems,
  translateLabel,
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

type ParamStatus = 'normal' | 'warn' | 'bad'

function statusColors(s: ParamStatus): { color: string; bg: string } {
  if (s === 'normal') return { color: 'var(--status-ok-text)', bg: 'var(--status-ok-bg)' }
  if (s === 'warn') return { color: 'var(--status-warn-text)', bg: 'var(--status-warn-bg)' }
  return { color: 'var(--status-danger-text)', bg: 'var(--status-danger-bg)' }
}

type Props = {
  actions: Action[]
  products: Product[]
  onEdit: (action: Action) => void
  onDelete: (action: Action) => void
  onExport?: () => void
  onImport?: (file: File) => Promise<void>
}

export default function DashboardPage({ actions, products: _products, onEdit, onDelete, onExport, onImport }: Props) {
  const { active, ranges } = useInstallation()
  const { theme } = useTheme()
  const { t, locale } = useT()
  const isDark = getIsDark(theme)
  const sanitizer = active?.sanitizer ?? 'chlorine'
  const [showAll, setShowAll] = useState(false)

  const today = new Date()
  const yearMonth = today.toISOString().slice(0, 7)

  const params = useMemo(() => extractMeasuredParams(actions), [actions])
  const phHistory = useMemo(() => getPhHistory(actions, 10), [actions])
  const thisMonthActions = useMemo(() => getActionsThisMonth(actions, yearMonth), [actions, yearMonth])
  const lastMonthActions = useMemo(() => getActionsLastMonth(actions), [actions])
  const daysSince = useMemo(() => daysSinceLastAction(actions), [actions])
  const nextMeasure = useMemo(() => getNextMeasureInDays(actions), [actions])
  const treatments = useMemo(() => getTreatmentsThisMonth(actions, yearMonth), [actions, yearMonth])
  const todoItems = useMemo(() => getTodoItems(actions, params, t), [actions, params, t])

  function lastActionLabel(): string {
    if (actions.length === 0) return '—'
    if (daysSince === 0) return t('kpi_today')
    if (daysSince === 1) return t('kpi_yesterday')
    const prefix = t('kpi_ago')
    return prefix ? `${prefix} ${daysSince} ${t('kpi_day_abbr')}` : `${daysSince} ${t('kpi_day_abbr')}`
  }

  function lastActionType(): string {
    if (actions.length === 0) return ''
    const sorted = [...actions].sort((a, b) => b.date.localeCompare(a.date))
    return sorted[0].action_type
  }

  function nextMeasureLabel(): string {
    if (nextMeasure === null) return t('kpi_never_measured')
    if (nextMeasure < 0) return t('kpi_overdue')
    return `${t('kpi_in')} ${nextMeasure} ${t('kpi_days_abbr')}`
  }

  function nextMeasureColor(): string {
    if (nextMeasure === null || nextMeasure <= 0) return 'var(--status-danger-text)'
    if (nextMeasure <= 2) return 'var(--status-warn-text)'
    return 'var(--text-primary)'
  }

  function vsLastMonth(): string {
    const diff = thisMonthActions.length - lastMonthActions.length
    const vs = t('kpi_vs_month')
    if (diff > 0) return `+${diff} ${vs}`
    if (diff < 0) return `${diff} ${vs}`
    return `= ${vs}`
  }

  const PH_MIN = 6.0
  const PH_MAX = 9.0
  const CHART_HEIGHT = 60

  function phBarHeight(ph: number): number {
    const ratio = Math.max(0, Math.min(1, (ph - PH_MIN) / (PH_MAX - PH_MIN)))
    return Math.round(ratio * CHART_HEIGHT)
  }

  function phBarColor(ph: number): string {
    if (isDark) {
      return ph >= 7.0 && ph <= 7.6 ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.3)'
    }
    return ph >= 7.0 && ph <= 7.6 ? '#a7f3d0' : '#fde68a'
  }

  const [hoveredRowId, setHoveredRowId] = useState<number | null>(null)

  const displayedActions = useMemo(() => {
    const sorted = [...actions].sort((a, b) => b.date.localeCompare(a.date))
    return showAll ? sorted : sorted.slice(0, 5)
  }, [actions, showAll])

  const kpiCardStyle: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 16px',
  }

  const sectionCardStyle: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '16px',
    marginBottom: 14,
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('page_log_title')}
        </div>
        <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {formatDateLong(today, locale)}
        </div>
      </div>

      {/* KPI grid */}
      <div className="kpi-grid">
        {/* Actions this month */}
        <div style={kpiCardStyle}>
          <div className="kpi-label" style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            {t('kpi_actions_month')}
          </div>
          <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '6px 0 4px' }}>
            {thisMonthActions.length}
          </div>
          <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)' }}>
            {vsLastMonth()}
          </div>
        </div>

        {/* Last action */}
        <div style={kpiCardStyle}>
          <div className="kpi-label" style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            {t('kpi_last_action')}
          </div>
          <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '6px 0 4px' }}>
            {lastActionLabel()}
          </div>
          <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)' }}>
            {lastActionType() ? translateLabel(t, ACTION_TYPE_LABELS, lastActionType()) : t('kpi_no_action')}
          </div>
        </div>

        {/* Next measurement */}
        <div style={kpiCardStyle}>
          <div className="kpi-label" style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            {t('kpi_next_measurement')}
          </div>
          <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 22, fontWeight: 700, color: nextMeasureColor(), margin: '6px 0 4px' }}>
            {nextMeasureLabel()}
          </div>
          <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)' }}>
            {t('kpi_recommended')}
          </div>
        </div>

        {/* Treatments this month */}
        <div style={kpiCardStyle}>
          <div className="kpi-label" style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            {t('kpi_treatments_month')}
          </div>
          <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '6px 0 4px' }}>
            {treatments.total}
          </div>
          <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)' }}>
            {treatments.maintenance} {t('kpi_maintenance')} · {treatments.additions} {t('kpi_additions')}
          </div>
        </div>
      </div>

      {/* Params banner */}
      <div className="params-banner" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 0', display: 'flex', marginBottom: 14 }}>
        <ParamBlock
          label={t('param_ph')}
          value={params.ph !== null ? params.ph.toFixed(1) : '—'}
          unit=""
          status={params.ph !== null ? getPhStatus(params.ph, ranges ?? undefined) : null}
          showDivider={false}
        />
        {sanitizer === 'bromine' ? (
          <ParamBlock
            label={t('param_bromine')}
            value={params.bromine !== null ? params.bromine.toFixed(1) : '—'}
            unit={active?.conc_unit ?? 'mg/L'}
            status={params.bromine !== null ? getBromineStatus(params.bromine, ranges ?? undefined) : null}
            showDivider={true}
          />
        ) : sanitizer === 'salt' ? (
          <>
            <ParamBlock
              label={t('param_salt')}
              value={params.salt !== null ? params.salt.toFixed(0) : '—'}
              unit={active?.salt_unit ?? 'ppm'}
              status={params.salt !== null ? getSaltStatus(params.salt, ranges ?? undefined) : null}
              showDivider={true}
            />
            <ParamBlock
              label={t('param_chlorine')}
              value={params.chlorine !== null ? params.chlorine.toFixed(1) : '—'}
              unit={active?.conc_unit ?? 'mg/L'}
              status={params.chlorine !== null ? getChlorineStatus(params.chlorine, ranges ?? undefined) : null}
              showDivider={true}
            />
          </>
        ) : (
          <ParamBlock
            label={t('param_chlorine')}
            value={params.chlorine !== null ? params.chlorine.toFixed(1) : '—'}
            unit={active?.conc_unit ?? 'mg/L'}
            status={params.chlorine !== null ? getChlorineStatus(params.chlorine, ranges ?? undefined) : null}
            showDivider={true}
          />
        )}
        <ParamBlock
          label={t('param_tac')}
          value={params.tac !== null ? String(Math.round(params.tac)) : '—'}
          unit={active?.conc_unit ?? 'mg/L'}
          status={params.tac !== null ? getTacStatus(params.tac, ranges ?? undefined) : null}
          showDivider={true}
        />
        <div style={{ flex: 1, padding: '0 20px', borderLeft: '1px solid var(--border-subtle)', opacity: params.temp === null ? 0.5 : 1 }}>
          <div className="kpi-label" style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            {t('param_temp_label')}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, margin: '6px 0 4px' }}>
            <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              {params.temp !== null ? params.temp.toFixed(1) : '—'}
            </span>
            {params.temp !== null && (
              <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: 'var(--text-muted)' }}>°{active?.temp_unit ?? 'C'}</span>
            )}
          </div>
          {params.temp !== null && (
            <StatusBadge status={getTempStatus(params.temp, ranges ?? undefined)} />
          )}
          {params.date && (
            <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
              {t('param_measured_on')} {formatShortDate(params.date)}
            </div>
          )}
        </div>
      </div>

      {/* 2-column layout */}
      <div className="dashboard-columns">
        {/* Left column */}
        <div>
          {/* Recent history card */}
          <div style={sectionCardStyle}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                {t('table_recent_history')}
              </div>
              <button
                onClick={() => setShowAll(v => !v)}
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 11,
                  color: 'var(--accent)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {showAll ? t('kpi_collapse') : t('kpi_see_all')}
              </button>
            </div>

            {actions.length === 0 ? (
              <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                {t('table_no_actions')}
              </p>
            ) : (
              <table className="history-table" style={{ marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{t('table_date')}</th>
                    <th style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{t('table_type')}</th>
                    <th className="history-col-params" style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{t('table_parameters')}</th>
                    <th className="history-col-notes" style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{t('table_notes')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {displayedActions.map(action => (
                    <tr
                      key={action.id}
                      onMouseEnter={() => setHoveredRowId(action.id)}
                      onMouseLeave={() => setHoveredRowId(null)}
                    >
                      <td style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-secondary)' }}>
                        {formatShortDate(action.date)}
                      </td>
                      <td>
                        <ActionTypeBadge actionType={action.action_type} />
                      </td>
                      <td className="history-col-params">
                        <ActionParamPills action={action} />
                      </td>
                      <td className="history-col-notes" style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {action.notes || '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 2, opacity: hoveredRowId === action.id ? 1 : 0, transition: 'opacity 0.15s' }}>
                          <button
                            onClick={() => onEdit(action)}
                            title={t('modal_edit')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => onDelete(action)}
                            title={t('modal_delete')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* pH trend card */}
          <div style={sectionCardStyle}>
            <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              {t('graph_ph_trend')}
            </div>
            {phHistory.length === 0 ? (
              <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                {t('graph_no_ph_measurement')}
              </p>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                {phHistory.map((point, i) => {
                  const barH = phBarHeight(point.ph)
                  const color = phBarColor(point.ph)
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 32 }}>
                      <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 9, color: 'var(--text-primary)', marginBottom: 2 }}>
                        {point.ph.toFixed(1)}
                      </div>
                      <div style={{
                        width: 24,
                        height: Math.max(barH, 4),
                        background: color,
                        borderRadius: '3px 3px 0 0',
                      }} />
                      <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                        {formatShortDate(point.date)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div>
          {/* WaterStatusCard */}
          <div style={{ marginBottom: 14 }}>
            <WaterStatusCard actions={actions} />
          </div>

          {/* To-do card */}
          <div style={sectionCardStyle}>
            <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              {t('todo_title')}
            </div>
            {todoItems.length === 0 ? (
              <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-ok-text)', margin: 0, textAlign: 'center' }}>
                {t('todo_all_ok')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {todoItems.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: item.iconBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      flexShrink: 0,
                    }}>
                      {item.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {item.title}
                      </div>
                      <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.subtitle}
                      </div>
                    </div>
                    <div style={{
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: 10,
                      color: item.isOverdue ? 'var(--status-danger-text)' : 'var(--text-muted)',
                      flexShrink: 0,
                    }}>
                      {item.delay}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Backups */}
      {(onExport || onImport) && (
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginRight: 4 }}>
            {t('backups')}
          </span>
          {onExport && (
            <button
              onClick={onExport}
              style={{
                fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600,
                color: 'var(--pooly-primary)', background: 'var(--bg-surface-2)',
                border: '1px solid var(--border)', borderRadius: 7,
                padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              {t('export_label')}
            </button>
          )}
          {onImport && (
            <label
              style={{
                fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600,
                color: 'var(--text-secondary)', background: 'var(--bg-surface-2)',
                border: '1px solid var(--border)', borderRadius: 7,
                padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              {t('import_label')}
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
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ParamBlock({
  label, value, unit, status, showDivider,
}: {
  label: string; value: string; unit: string; status: ParamStatus | null; showDivider: boolean
}) {
  const hasData = value !== '—'
  return (
    <div style={{
      flex: 1, padding: '0 20px',
      borderLeft: showDivider ? '1px solid var(--border-subtle)' : 'none',
      opacity: hasData ? 1 : 0.5,
    }}>
      <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, margin: '6px 0 4px' }}>
        <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
          {value}
        </span>
        {unit && hasData && (
          <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: 'var(--text-muted)' }}>{unit}</span>
        )}
      </div>
      {status !== null && hasData && <StatusBadge status={status} />}
    </div>
  )
}

function StatusBadge({ status }: { status: ParamStatus }) {
  const { t } = useT()
  const { color, bg } = statusColors(status)
  const label = status === 'normal' ? t('status_normal') : status === 'warn' ? t('status_watch') : t('status_out_of_range')
  return (
    <span style={{
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 10, fontWeight: 600,
      color, background: bg,
      padding: '2px 6px', borderRadius: 4, display: 'inline-block',
    }}>
      {label}
    </span>
  )
}

function ActionTypeBadge({ actionType }: { actionType: string }) {
  const { t } = useT()
  let color = 'var(--text-muted)', bg = 'var(--bg-surface-2)'
  if (actionType === 'Measurement' || actionType === 'pH Measurement') {
    color = 'var(--badge-orange-text)'; bg = 'var(--badge-orange-bg)'
  } else if (actionType === 'Add product') {
    color = 'var(--badge-purple-text)'; bg = 'var(--badge-purple-bg)'
  } else if (
    actionType === 'Cartridge cleaning' || actionType === 'Skimmer filter cleaning' ||
    actionType === 'Backwash' || actionType === 'pH calibration'
  ) {
    color = 'var(--badge-blue-text)'; bg = 'var(--badge-blue-bg)'
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
