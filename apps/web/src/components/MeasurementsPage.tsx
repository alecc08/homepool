import { useState, useMemo } from 'react'
import type { Action } from '../types'
import {
  PARAM_RANGES,
  getWaterStatus,
  getPhStatus,
  getChlorineStatus,
  getTacStatus,
  getTempStatus,
  getPhHistory,
  getChlorineHistory,
  getFilteredMeasureActions,
  getPhTrend,
  getDaysSince,
  extractMeasuredParams,
} from '../utils'
import { useT } from '../context/LocaleContext'
import { useInstallation } from '../context/InstallationContext'
import type { Locale } from '../i18n/translations'
import type { DynamicRanges } from '../utils'

// ── Types ──────────────────────────────────────────────────────────────────

type Period = 1 | 3 | 6 | null
type ParamStatus = 'normal' | 'warn' | 'bad'

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatShort(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${d}/${m}`
}

function formatDateLong(dateStr: string, locale: Locale): string {
  const [y, m, d] = dateStr.split('-')
  const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d))
  return date.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function valueColor(status: ParamStatus): string {
  if (status === 'normal') return 'var(--status-ok-text)'
  if (status === 'warn') return 'var(--status-warn-text)'
  return 'var(--status-danger-text)'
}

function cellValue(
  value: number | null,
  statusFn: (v: number) => ParamStatus,
  fmt: (v: number) => string,
): React.ReactNode {
  if (value === null) return <span style={{ color: 'var(--text-muted)', fontFamily: '"IBM Plex Mono", monospace', fontSize: 12 }}>—</span>
  const s = statusFn(value)
  return (
    <span style={{ color: valueColor(s), fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, fontWeight: 600 }}>
      {fmt(value)}
    </span>
  )
}

// ── Bar chart (CSS pure) ────────────────────────────────────────────────────

const CHART_H = 72

type BarChartProps = {
  bars: { date: string; value: number; colorClass: string; label: string }[]
  empty: string
  notEnough: string
}

function BarChart({ bars, empty, notEnough }: BarChartProps) {
  if (bars.length === 0) {
    return (
      <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
        {empty}
      </p>
    )
  }
  if (bars.length < 2) {
    return (
      <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>
        {notEnough}
      </p>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
      {bars.map((b, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 30 }}>
          <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 3 }}>
            {b.label}
          </div>
          <div className={b.colorClass} style={{ width: 22, height: Math.max(b.value, 4), borderRadius: '3px 3px 0 0' }} />
          <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', marginTop: 4 }}>
            {formatShort(b.date)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ ph, chlorine, tac, ranges }: { ph: number | null; chlorine: number | null; tac: number | null; ranges?: DynamicRanges }) {
  const { t } = useT()
  const { status, hasData } = getWaterStatus({ ph, chlorine, tac }, ranges)
  if (!hasData) return <span style={{ color: 'var(--text-muted)', fontFamily: '"IBM Plex Mono", monospace', fontSize: 10 }}>—</span>
  const cfg = {
    clear:  { label: t('status_normal'),     color: 'var(--status-ok-text)',     bg: 'var(--status-ok-bg)'     },
    cloudy: { label: t('status_watch'), color: 'var(--status-warn-text)',   bg: 'var(--status-warn-bg)'   },
    green:  { label: t('status_out_of_range'), color: 'var(--status-danger-text)', bg: 'var(--status-danger-bg)' },
  }[status]
  return (
    <span style={{
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 10, fontWeight: 600,
      color: cfg.color, background: cfg.bg,
      padding: '2px 6px', borderRadius: 4, display: 'inline-block', whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  )
}

// ── Card & KPI styles ──────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
}

const kpiLabel: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 9,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
}

const kpiValue: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--text-primary)',
  margin: '6px 0 4px',
  lineHeight: 1.2,
}

const kpiSub: React.CSSProperties = {
  fontFamily: '"Sora", sans-serif',
  fontSize: 11,
  color: 'var(--text-muted)',
}

// ── Main component ─────────────────────────────────────────────────────────

type Props = { actions: Action[] }

export default function MeasurementsPage({ actions }: Props) {
  const { t, locale } = useT()
  const { active, ranges } = useInstallation()
  const [period, setPeriod] = useState<Period>(1)

  const PERIODS: { label: string; value: Period }[] = [
    { label: t('measurements_filter_month'),  value: 1 },
    { label: t('measurements_filter_3months'), value: 3 },
    { label: t('measurements_filter_6months'), value: 6 },
    { label: t('measurements_filter_all'),  value: null },
  ]

  const today = new Date()
  const yearMonth = today.toISOString().slice(0, 7)

  // KPI 1: measurements this month
  const measuresThisMonth = useMemo(() =>
    actions.filter(a => {
      const isMeasure = a.action_type === 'Measurement' || a.action_type === 'pH Measurement'
      return isMeasure && a.date.startsWith(yearMonth)
    }).length
  , [actions, yearMonth])

  // KPI 2: pH trend this month
  const phTrend = useMemo(() => getPhTrend(actions, yearMonth), [actions, yearMonth])

  // KPI 3: last reading
  const lastMeasure = useMemo(() => {
    const ms = actions
      .filter(a => a.action_type === 'Measurement' || a.action_type === 'pH Measurement')
      .sort((a, b) => b.date.localeCompare(a.date))
    return ms[0] ?? null
  }, [actions])

  // Filtered set (graphs + table)
  const filtered = useMemo(() => getFilteredMeasureActions(actions, period), [actions, period])

  // pH chart bars (last 7) — fixed scale 6.0–9.0
  const phBars = useMemo(() => {
    const pts = getPhHistory(filtered, 7)
    const PH_MIN = 6.0, PH_MAX = 9.0
    const { ideal, acceptable } = ranges?.ph ?? PARAM_RANGES.ph
    return pts.map(p => {
      const ratio = Math.max(0, Math.min(1, (p.ph - PH_MIN) / (PH_MAX - PH_MIN)))
      const h = Math.max(Math.round(ratio * CHART_H), 4)
      const [iMin, iMax] = ideal
      const [aMin, aMax] = acceptable
      const colorClass = (p.ph >= iMin && p.ph <= iMax) ? 'bar-ok'
        : (p.ph >= aMin && p.ph <= aMax) ? 'bar-warn'
        : 'bar-danger'
      return { date: p.date, value: h, colorClass, label: p.ph.toFixed(1) }
    })
  }, [filtered, ranges])

  // Chlorine chart bars (last 7)
  const clBars = useMemo(() => {
    const pts = getChlorineHistory(filtered, 7)
    const { ideal, acceptable } = ranges?.chlorine ?? PARAM_RANGES.chlorine
    const CL_MAX = Math.max(5, acceptable[1])
    return pts.map(p => {
      const ratio = Math.max(0, Math.min(1, p.chlorine / CL_MAX))
      const h = Math.max(Math.round(ratio * CHART_H), 4)
      const [iMin, iMax] = ideal
      const [aMin, aMax] = acceptable
      const colorClass = (p.chlorine >= iMin && p.chlorine <= iMax) ? 'bar-ok'
        : (p.chlorine >= aMin && p.chlorine <= aMax) ? 'bar-warn'
        : 'bar-danger'
      return { date: p.date, value: h, colorClass, label: p.chlorine.toFixed(1) }
    })
  }, [filtered, ranges])

  // Table rows: one per measure action with at least one param, newest first
  const tableRows = useMemo(() =>
    filtered
      .map(a => {
        const p = extractMeasuredParams([a])
        return { action: a, ph: p.ph, chlorine: p.chlorine, tac: p.tac, temp: p.temp }
      })
      .filter(r => r.ph !== null || r.chlorine !== null || r.tac !== null || r.temp !== null)
  , [filtered])

  // ── Trend sub-text ────────────────────────────────────────────────────────
  function trendNode() {
    if (!phTrend) return <span style={kpiSub}>{t('measurements_not_enough_data')}</span>
    const { trend } = phTrend
    const cfg = {
      up:     { icon: '↑', label: t('measurements_rising'), color: 'var(--status-ok-text)'     },
      down:   { icon: '↓', label: t('measurements_falling'), color: 'var(--status-danger-text)' },
      stable: { icon: '→', label: t('measurements_stable'), color: 'var(--text-muted)'         },
    }[trend]
    return (
      <span style={{ ...kpiSub, color: cfg.color, fontWeight: 500 }}>
        {cfg.icon} {cfg.label}
      </span>
    )
  }

  function daysAgoLabel(n: number): string {
    if (n === 0) return t('kpi_today')
    if (n === 1) return t('measurements_ago_1')
    return [t('measurements_ago_n'), String(n), t('measurements_days_ago')].filter(Boolean).join(' ')
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('page_measurements_title')}
        </div>
        <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {t('page_measurements_sub')}
        </div>
      </div>

      {/* ── Zone 1: KPIs ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>

        {/* KPI 1 */}
        <div style={{ ...card, padding: '12px 14px' }}>
          <div style={kpiLabel}>{t('measurements_this_month')}</div>
          <div style={kpiValue}>{measuresThisMonth}</div>
          <div style={kpiSub}>{t('measurements_records_saved')}</div>
        </div>

        {/* KPI 2 — Tendance pH */}
        <div style={{ ...card, padding: '12px 14px' }}>
          <div style={kpiLabel}>{t('measurements_ph_trend')}</div>
          {phTrend ? (
            <div style={{ ...kpiValue, fontSize: 16 }}>
              {phTrend.first.toFixed(1)} → {phTrend.last.toFixed(1)}
            </div>
          ) : (
            <div style={{ ...kpiValue, fontSize: 16, color: 'var(--text-muted)' }}>—</div>
          )}
          {trendNode()}
        </div>

        {/* KPI 3 — Last reading */}
        <div style={{ ...card, padding: '12px 14px' }}>
          <div style={kpiLabel}>{t('measurements_last_record')}</div>
          {lastMeasure ? (
            <>
              <div style={{ ...kpiValue, fontSize: 16 }}>{formatDateLong(lastMeasure.date, locale)}</div>
              <div style={kpiSub}>{daysAgoLabel(getDaysSince(lastMeasure.date))}</div>
            </>
          ) : (
            <>
              <div style={{ ...kpiValue, color: 'var(--text-muted)' }}>—</div>
              <div style={kpiSub}>{t('measurements_no_record')}</div>
            </>
          )}
        </div>
      </div>

      {/* ── Period filters ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {PERIODS.map(p => {
          const active = p.value === period
          return (
            <button
              key={String(p.value)}
              onClick={() => setPeriod(p.value)}
              style={{
                fontFamily: '"Sora", sans-serif',
                fontSize: 12,
                fontWeight: 500,
                padding: '5px 12px',
                borderRadius: 7,
                border: '1px solid var(--border)',
                cursor: 'pointer',
                background: active ? 'var(--text-primary)' : 'var(--bg-surface)',
                color: active ? 'var(--bg-surface)' : 'var(--text-muted)',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* ── Zone 2: Charts ───────────────────────────────────────────────── */}
      <div className="measurements-charts">

        {/* pH chart */}
        <div style={{ ...card, padding: 16 }}>
          <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
            {t('graph_ph_trend')}
          </div>
          <BarChart bars={phBars} empty={t('measurements_no_ph_period')} notEnough={t('graph_not_enough_data')} />
        </div>

        {/* Chlorine chart */}
        <div style={{ ...card, padding: 16 }}>
          <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
            {t('graph_chlorine_trend')}
          </div>
          <BarChart bars={clBars} empty={t('measurements_no_chlorine_period')} notEnough={t('graph_not_enough_data')} />
        </div>
      </div>

      {/* ── Zone 3: Table ────────────────────────────────────────────────── */}
      <div style={{ ...card, padding: 16, marginTop: 14 }}>
        {/* Table header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
            {t('measurements_all_records')}
          </div>
          <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, color: 'var(--text-muted)' }}>
            {tableRows.length} {t('measurements_records_saved')}
          </div>
        </div>

        {tableRows.length === 0 ? (
          <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            {t('measurements_no_records_period')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="measurements-table">
              <thead>
                <tr>
                  {[t('table_date'), t('param_ph'), t('param_chlorine'), t('param_tac'), t('param_temp_label'), t('measurements_status')].map(col => (
                    <th key={col} style={{
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: 10, fontWeight: 500,
                      textTransform: 'uppercase', color: 'var(--text-muted)',
                      textAlign: 'left', padding: '0 8px 8px 0',
                      borderBottom: '1px solid var(--border-subtle)',
                      whiteSpace: 'nowrap',
                    }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map(({ action, ph, chlorine, tac, temp }) => (
                  <tr key={action.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '9px 8px 9px 0', fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {formatShort(action.date)}
                    </td>
                    <td style={{ padding: '9px 8px 9px 0' }}>
                      {cellValue(ph, v => getPhStatus(v, ranges ?? undefined), v => v.toFixed(1))}
                    </td>
                    <td style={{ padding: '9px 8px 9px 0' }}>
                      {cellValue(chlorine, v => getChlorineStatus(v, ranges ?? undefined), v => `${v.toFixed(1)} ${active?.conc_unit ?? 'mg/L'}`)}
                    </td>
                    <td style={{ padding: '9px 8px 9px 0' }}>
                      {cellValue(tac, v => getTacStatus(v, ranges ?? undefined), v => `${Math.round(v)} ${active?.conc_unit ?? 'mg/L'}`)}
                    </td>
                    <td style={{ padding: '9px 8px 9px 0' }}>
                      {cellValue(temp, v => getTempStatus(v, ranges ?? undefined), v => `${v.toFixed(1)} °${active?.temp_unit ?? 'C'}`)}
                    </td>
                    <td style={{ padding: '9px 8px 9px 0' }}>
                      <StatusBadge ph={ph} chlorine={chlorine} tac={tac} ranges={ranges ?? undefined} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
