import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useT } from '../context/LocaleContext'
import { useInstallation } from '../context/InstallationContext'
import { installationParamsToRanges } from '../utils'
import { PARAM_GUIDANCE, PARAM_ORDER } from '../paramGuidance'
import type { Installation, InstallationParamsFull, InstallationWaterParams, ParamKey } from '../types'
import { metricToDisplayConverter, displayToMetricConverter } from '../units'

type Band = 'ideal' | 'acceptable'
type Edge = 0 | 1
type DraftValues = Record<string, [string, string]> // `${param}:${band}` -> [minStr, maxStr]

type Props = {
  installation: Installation
}

function metricToDisplay(param: ParamKey, value: number, installation: Installation): number {
  const convert = metricToDisplayConverter(param, installation)
  return convert ? convert(value) : value
}

function displayToMetric(param: ParamKey, value: number, installation: Installation): number {
  const convert = displayToMetricConverter(param, installation)
  return convert ? convert(value) : value
}

function unitLabel(param: ParamKey, installation: Installation): string {
  switch (param) {
    case 'temp': return `°${installation.temp_unit ?? 'C'}`
    case 'salt': return installation.salt_unit ?? 'ppm'
    case 'hardness': return installation.hardness_unit ?? 'ppm'
    case 'cl': case 'br': case 'cc': return installation.conc_unit ?? 'mg/L'
    case 'tac': case 'cya': return 'ppm'
    case 'ph': default: return ''
  }
}

const key = (param: string, band: Band) => `${param}:${band}`

export default function WaterChemistryTargets({ installation }: Props) {
  const { t } = useT()
  const { updateRanges } = useInstallation()
  const [full, setFull] = useState<InstallationParamsFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState<DraftValues>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    fetch(`/api/installations/${installation.id}/params/full`, { credentials: 'same-origin' })
      .then(res => { if (!res.ok) throw new Error('failed'); return res.json() })
      .then((data: InstallationParamsFull) => {
        if (cancelled) return
        setFull(data)
        const draft: DraftValues = {}
        for (const param of Object.keys(data) as ParamKey[]) {
          const entry = data[param]
          if (!entry) continue
          for (const band of ['ideal', 'acceptable'] as Band[]) {
            const [min, max] = entry.effective[band]
            draft[key(param, band)] = [
              String(round(metricToDisplay(param, min, installation))),
              String(round(metricToDisplay(param, max, installation))),
            ]
          }
        }
        setValues(draft)
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installation.id])

  const paramKeys = useMemo(
    () => (full ? PARAM_ORDER.filter(p => full[p]) : []),
    [full]
  )

  const parsed = useMemo(() => {
    const out: Record<string, [number, number]> = {}
    for (const k of Object.keys(values)) {
      const [minStr, maxStr] = values[k]
      out[k] = [parseFloat(minStr), parseFloat(maxStr)]
    }
    return out
  }, [values])

  const errors = useMemo(() => {
    const out: Record<ParamKey, string | null> = {} as Record<ParamKey, string | null>
    for (const param of paramKeys) {
      const guidance = PARAM_GUIDANCE[param]
      const ideal = parsed[key(param, 'ideal')]
      const acceptable = parsed[key(param, 'acceptable')]
      if (!ideal || !acceptable || ideal.some(isNaN) || acceptable.some(isNaN)) {
        out[param] = t('ranges_error_min_lt_max')
        continue
      }
      if (ideal[0] >= ideal[1] || acceptable[0] >= acceptable[1]) {
        out[param] = t('ranges_error_min_lt_max')
        continue
      }
      if (ideal[0] < acceptable[0] || ideal[1] > acceptable[1]) {
        out[param] = t('ranges_error_ideal_subset')
        continue
      }
      const [boundMin, boundMax] = guidance.bounds
      const dispMin = metricToDisplay(param, boundMin, installation)
      const dispMax = metricToDisplay(param, boundMax, installation)
      const lo = Math.min(dispMin, dispMax)
      const hi = Math.max(dispMin, dispMax)
      if (acceptable[0] < lo || acceptable[1] > hi) {
        out[param] = t('ranges_error_bounds')
        continue
      }
      out[param] = null
    }
    return out
  }, [paramKeys, parsed, installation, t])

  const hasErrors = paramKeys.some(p => errors[p])

  // Single source of truth for "does this param differ from its default", derived
  // from the same metric-space diff-against-default logic handleSave uses to decide
  // what to send — avoids a separately-maintained overridden Set that could disagree.
  const customized = useMemo(() => {
    const out: Record<ParamKey, boolean> = {} as Record<ParamKey, boolean>
    for (const param of paramKeys) {
      const entry = full?.[param]
      if (!entry) { out[param] = false; continue }
      out[param] = (['ideal', 'acceptable'] as Band[]).some(band => {
        const vals = parsed[key(param, band)]
        if (!vals || vals.some(isNaN)) return true
        const min = displayToMetric(param, vals[0], installation)
        const max = displayToMetric(param, vals[1], installation)
        const [defMin, defMax] = entry.default[band]
        return Math.abs(min - defMin) > 1e-9 || Math.abs(max - defMax) > 1e-9
      })
    }
    return out
  }, [paramKeys, parsed, full, installation])

  const handleChange = (param: ParamKey, band: Band, edge: Edge, raw: string) => {
    setValues(prev => {
      const current = prev[key(param, band)] ?? ['', '']
      const next: [string, string] = [...current] as [string, string]
      next[edge] = raw
      return { ...prev, [key(param, band)]: next }
    })
  }

  const resetParam = (param: ParamKey) => {
    if (!full) return
    const entry = full[param]
    if (!entry) return
    setValues(prev => {
      const next = { ...prev }
      for (const band of ['ideal', 'acceptable'] as Band[]) {
        const [min, max] = entry.default[band]
        next[key(param, band)] = [
          String(round(metricToDisplay(param, min, installation))),
          String(round(metricToDisplay(param, max, installation))),
        ]
      }
      return next
    })
  }

  const resetAll = () => {
    paramKeys.forEach(resetParam)
  }

  const handleSave = async () => {
    if (!full || hasErrors) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload: Record<string, Record<string, [number, number]>> = {}
      for (const param of paramKeys) {
        if (!customized[param]) continue
        const entry = full[param]
        if (!entry) continue
        const bands: Record<string, [number, number]> = {}
        for (const band of ['ideal', 'acceptable'] as Band[]) {
          const [minStr, maxStr] = values[key(param, band)]
          const min = displayToMetric(param, parseFloat(minStr), installation)
          const max = displayToMetric(param, parseFloat(maxStr), installation)
          const [defMin, defMax] = entry.default[band]
          if (Math.abs(min - defMin) > 1e-9 || Math.abs(max - defMax) > 1e-9) {
            bands[band] = [min, max]
          }
        }
        if (Object.keys(bands).length > 0) payload[param] = bands
      }

      const res = await fetch(`/api/installations/${installation.id}/params`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('failed')
      const merged: InstallationWaterParams = await res.json()
      updateRanges(installationParamsToRanges(merged, installation))
    } catch {
      setSaveError(t('ranges_save_error'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-secondary)' }}>{t('ranges_loading')}</p>
  }
  if (loadError || !full) {
    return <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)' }}>{t('ranges_load_error')}</p>
  }

  const labelStyle: React.CSSProperties = { fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }
  const rowStyle: React.CSSProperties = {
    display: 'grid', gap: 8, padding: '12px 0',
    borderBottom: '1px solid var(--border)',
  }
  const bandRow: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-end' }
  const numInput: React.CSSProperties = { width: '100%' }

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="water-chemistry-targets">
      <div className="flex-1 overflow-y-auto overscroll-contain" style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={resetAll}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-secondary)',
            textDecoration: 'underline', padding: 0,
          }}
        >
          {t('ranges_reset_all')}
        </button>
      </div>

      {paramKeys.map(param => {
        const guidance = PARAM_GUIDANCE[param]
        const unit = unitLabel(param, installation)
        const isOverridden = customized[param]
        const error = errors[param]
        const idealVals = values[key(param, 'ideal')] ?? ['', '']
        const acceptableVals = values[key(param, 'acceptable')] ?? ['', '']

        return (
          <div key={param} style={rowStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {t(guidance.labelKey)}
                </span>
                {unit && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-secondary)' }}>{unit}</span>}
                {isOverridden && <Badge variant="secondary">{t('ranges_customized')}</Badge>}
              </div>
              {isOverridden && (
                <button
                  type="button"
                  onClick={() => resetParam(param)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: '"Sora", sans-serif', fontSize: 11, color: '#2dd4bf', padding: 0,
                  }}
                >
                  {t('ranges_reset_param')}
                </button>
              )}
            </div>

            <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>
              {t(guidance.whyKey)}
            </p>

            {guidance.prominent && (
              <div style={{
                padding: '8px 10px', borderRadius: 8,
                background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.3)',
                fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-primary)',
              }}>
                {guidance.extraKey && <div>{t(guidance.extraKey)}</div>}
                {guidance.sourceKey && (
                  <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{t(guidance.sourceKey)}</div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1, display: 'grid', gap: 4 }}>
                <span style={labelStyle}>{t('ranges_acceptable')}</span>
                <div style={bandRow}>
                  <Input
                    type="number" step="any" style={numInput}
                    value={acceptableVals[0]}
                    onChange={e => handleChange(param, 'acceptable', 0, e.target.value)}
                    aria-label={`${t(guidance.labelKey)} ${t('ranges_acceptable')} ${t('ranges_min')}`}
                  />
                  <Input
                    type="number" step="any" style={numInput}
                    value={acceptableVals[1]}
                    onChange={e => handleChange(param, 'acceptable', 1, e.target.value)}
                    aria-label={`${t(guidance.labelKey)} ${t('ranges_acceptable')} ${t('ranges_max')}`}
                  />
                </div>
              </div>
              <div style={{ flex: 1, display: 'grid', gap: 4 }}>
                <span style={labelStyle}>{t('ranges_ideal')}</span>
                <div style={bandRow}>
                  <Input
                    type="number" step="any" style={numInput}
                    value={idealVals[0]}
                    onChange={e => handleChange(param, 'ideal', 0, e.target.value)}
                    aria-label={`${t(guidance.labelKey)} ${t('ranges_ideal')} ${t('ranges_min')}`}
                  />
                  <Input
                    type="number" step="any" style={numInput}
                    value={idealVals[1]}
                    onChange={e => handleChange(param, 'ideal', 1, e.target.value)}
                    aria-label={`${t(guidance.labelKey)} ${t('ranges_ideal')} ${t('ranges_max')}`}
                  />
                </div>
              </div>
            </div>

            {error && (
              <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--status-danger-text)', margin: 0 }}>
                {error}
              </p>
            )}
          </div>
        )
      })}
      </div>

      {saveError && (
        <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)', margin: '8px 0 0' }}>
          {saveError}
        </p>
      )}

      <Button type="button" onClick={handleSave} disabled={saving || hasErrors} className="w-full" style={{ marginTop: 12, flexShrink: 0 }}>
        {saving ? t('modal_install_saving') : t('modal_install_save')}
      </Button>
    </div>
  )
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
