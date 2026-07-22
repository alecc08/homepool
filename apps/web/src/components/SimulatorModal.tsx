import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import { PARAM_GUIDANCE } from '../paramGuidance'
import { displayToMetricConverter, gramsToDisplay, mlToDisplay } from '../units'
import { extractMeasuredParams, type MeasuredParams } from '../utils'
import type { Action, DosageOption, Installation, InstallationWaterParams, ParamBand, ParamKey } from '../types'
import type { TranslationKey } from '../i18n/translations'

// Params dosage.py's TREATMENT_TABLE has actionable guidance for -- cc and temp are
// deliberately absent, same as the real Recommendations page.
const SIMULATOR_DOSAGE_PARAMS: ParamKey[] = ['ph', 'cl', 'br', 'tac', 'salt', 'cya', 'hardness']

const GAL_TO_L = 3.78541

type Props = {
  open: boolean
  onClose: () => void
  actions: Action[]
}

type Tab = 'dosage' | 'heating'

type DosageResult = {
  param: ParamKey
  current_value: number
  target_value: number
  direction: 'raise' | 'lower'
  volume_known: boolean
  options: DosageOption[]
}

type HeatingResult = {
  kwh: number
  delta_temp_c: number
  efficiency: number
}

const sectionStyle: React.CSSProperties = {
  display: 'grid', gap: 8,
}

// salt/hardness are entered in canonical ppm here (unlike the installation's own unit
// settings) to keep the freestyle what-if math unambiguous -- TREATMENT_TABLE's dosing
// constants are calibrated to ppm.
function unitLabelFor(param: ParamKey, concUnit: string): string {
  switch (param) {
    case 'cl': case 'br': return concUnit
    case 'tac': case 'cya': return 'ppm'
    case 'salt': return 'ppm'
    case 'hardness': return 'ppm'
    case 'ph': default: return ''
  }
}

function stepFor(param: ParamKey): number {
  if (param === 'ph') return 0.05
  if (param === 'cl' || param === 'br') return 0.1
  return 1
}

// Maps a dosage ParamKey to extractMeasuredParams' (differently-named) field, for
// prefilling the sliders from the installation's own logged measurements. Excludes
// 'date' (the one non-numeric MeasuredParams field) so measured[key] below stays a
// plain number | null instead of widening to include 'date's string | null.
const MEASURED_KEY_FOR_PARAM: Partial<Record<ParamKey, Exclude<keyof MeasuredParams, 'date'>>> = {
  ph: 'ph', cl: 'chlorine', br: 'bromine', tac: 'tac', salt: 'salt', cya: 'stabilizer', hardness: 'hardness',
}

function measuredValueFor(param: ParamKey, measured: MeasuredParams, installation: Installation | null): number | null {
  const key = MEASURED_KEY_FOR_PARAM[param]
  if (!key) return null
  const raw = measured[key]
  if (raw == null) return null
  // Only salt/hardness actually convert between display and canonical units --
  // everything else here is display-label-only (see units.ts).
  if (param === 'salt' || param === 'hardness') {
    const toMetric = displayToMetricConverter(param, installation ?? undefined)
    return toMetric ? toMetric(raw) : raw
  }
  return raw
}

export default function SimulatorModal({ open, onClose, actions }: Props) {
  const { t } = useT()
  const { active, ranges } = useInstallation()
  const [tab, setTab] = useState<Tab>('dosage')
  const [waterParams, setWaterParams] = useState<InstallationWaterParams | null>(null)

  const measured = useMemo(() => extractMeasuredParams(actions), [actions])

  useEffect(() => {
    if (!open || !active) return
    let cancelled = false
    fetch(`/api/installations/${active.id}/params`, { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) setWaterParams(data) })
      .catch(() => { if (!cancelled) setWaterParams(null) })
    return () => { cancelled = true }
  }, [open, active?.id])

  const handleClose = () => onClose()

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: '"Sora", sans-serif', fontWeight: 600 }}>
            {t('simulator_title')}
          </DialogTitle>
        </DialogHeader>

        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 4 }}>
          {t('simulator_subtitle')}
        </div>

        <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
          {(['dosage', 'heating'] as Tab[]).map(tb => (
            <button
              key={tb}
              type="button"
              onClick={() => setTab(tb)}
              style={{
                padding: '8px 4px', background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600,
                color: tab === tb ? 'var(--accent)' : 'var(--text-secondary)',
                borderBottom: tab === tb ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {tb === 'dosage' ? t('simulator_tab_dosage') : t('simulator_tab_heating')}
            </button>
          ))}
        </div>

        {tab === 'dosage'
          ? (
            <DosageTab
              installationVolume={active?.volume ?? undefined}
              volumeUnit={active?.volume_unit ?? 'L'}
              sanitizer={active?.sanitizer ?? 'chlorine'}
              concUnit={active?.conc_unit ?? 'mg/L'}
              waterParams={waterParams}
              measured={measured}
              active={active}
            />
          )
          : (
            <HeatingTab
              installationVolume={active?.volume ?? undefined}
              volumeUnit={active?.volume_unit ?? 'L'}
              tempUnit={active?.temp_unit ?? 'C'}
              tempRange={ranges?.temp}
              measuredTemp={measured.temp}
            />
          )}
      </DialogContent>
    </Dialog>
  )
}

function ParamSlider({
  label, unit, min, max, step, idealMin, idealMax, value, onChange,
}: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  idealMin: number
  idealMax: number
  value: number
  onChange: (v: number) => void
}) {
  const pct = (v: number) => (max > min ? ((v - min) / (max - min)) * 100 : 0)
  const idealStartPct = pct(idealMin)
  const idealEndPct = pct(idealMax)
  const gradient = `linear-gradient(to right, var(--border) 0%, var(--border) ${idealStartPct}%, var(--accent) ${idealStartPct}%, var(--accent) ${idealEndPct}%, var(--border) ${idealEndPct}%, var(--border) 100%)`

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Label style={{ margin: 0 }}>{label}</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Input
            type="number"
            step="any"
            value={value}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (!isNaN(v)) onChange(v)
            }}
            style={{ width: 76, height: 26, fontSize: 12, textAlign: 'right', padding: '2px 6px' }}
          />
          {unit && (
            <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: 'var(--text-muted)' }}>
              {unit}
            </span>
          )}
        </div>
      </div>
      <input
        type="range"
        className="param-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ background: gradient }}
      />
    </div>
  )
}

function DosageTab({
  installationVolume, volumeUnit, sanitizer, concUnit, waterParams, measured, active,
}: {
  installationVolume?: number
  volumeUnit: 'L' | 'gal'
  sanitizer: 'bromine' | 'chlorine' | 'salt'
  concUnit: string
  waterParams: InstallationWaterParams | null
  measured: MeasuredParams
  active: Installation | null
}) {
  const { t } = useT()
  const [param, setParam] = useState<ParamKey>('ph')
  const [current, setCurrent] = useState(7.4)
  const [target, setTarget] = useState(7.4)
  const [volume, setVolume] = useState(installationVolume != null ? String(installationVolume) : '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DosageResult | null>(null)

  const unit = useMemo(() => unitLabelFor(param, concUnit), [param, concUnit])
  const guidance = PARAM_GUIDANCE[param]

  const band: ParamBand = waterParams?.[param] ?? { ideal: guidance.bounds, acceptable: guidance.bounds }
  const [min, max] = band.acceptable
  const [idealMin, idealMax] = band.ideal

  useEffect(() => {
    const mid = (idealMin + idealMax) / 2
    const measuredValue = measuredValueFor(param, measured, active)
    setCurrent(measuredValue ?? mid)
    setTarget(mid)
    setResult(null)
  }, [param, idealMin, idealMax, measured, active])

  async function handleCalculate() {
    setError(null)
    setResult(null)
    const volumeValue = parseFloat(volume)
    if (isNaN(volumeValue)) {
      setError(t('simulator_dosage_error_generic'))
      return
    }
    const volumeL = volumeUnit === 'gal' ? volumeValue * GAL_TO_L : volumeValue

    setLoading(true)
    try {
      const res = await fetch('/api/simulate/dosage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          param, current_value: current, target_value: target,
          volume_L: volumeL, sanitizer,
        }),
      })
      if (!res.ok) {
        setError(current === target ? t('simulator_dosage_error_same_value') : t('simulator_dosage_error_generic'))
        return
      }
      setResult(await res.json())
    } catch {
      setError(t('simulator_dosage_error_generic'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={sectionStyle}>
        <Label>{t('simulator_dosage_param_label')}</Label>
        <Select value={param} onValueChange={v => setParam(v as ParamKey)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SIMULATOR_DOSAGE_PARAMS.map(p => (
              <SelectItem key={p} value={p}>{t(PARAM_GUIDANCE[p].labelKey)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ParamSlider
        label={t('simulator_dosage_current_label')}
        unit={unit}
        min={min} max={max} step={stepFor(param)}
        idealMin={idealMin} idealMax={idealMax}
        value={current}
        onChange={setCurrent}
      />
      <ParamSlider
        label={t('simulator_dosage_target_label')}
        unit={unit}
        min={min} max={max} step={stepFor(param)}
        idealMin={idealMin} idealMax={idealMax}
        value={target}
        onChange={setTarget}
      />

      <div style={sectionStyle}>
        <Label htmlFor="sim-volume">{t('simulator_dosage_volume_label')} ({volumeUnit})</Label>
        <Input id="sim-volume" type="number" min="0" step="any" value={volume} onChange={e => setVolume(e.target.value)} />
      </div>

      {error && (
        <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)', margin: 0 }}>
          {error}
        </p>
      )}

      <Button type="button" onClick={handleCalculate} disabled={loading} className="w-full">
        {t('simulator_dosage_calculate')}
      </Button>

      {result && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px',
          background: 'var(--bg-surface-2)', display: 'grid', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {guidance ? t(guidance.labelKey) : result.param}
            </div>
            <span style={{
              fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, fontWeight: 600,
              color: result.direction === 'raise' ? 'var(--status-warn-text)' : 'var(--status-danger-text)',
              padding: '2px 8px', borderRadius: 4,
            }}>
              {result.direction === 'raise' ? t('recommendations_raise') : t('recommendations_lower')}
            </span>
          </div>
          {result.options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {opt.product_id && (
                <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {t(`dosage_product_${opt.product_id}` as TranslationKey)}
                </div>
              )}
              {(opt.amount_grams !== null || opt.amount_ml !== null) && (
                <AmountLine grams={opt.amount_grams ?? undefined} mL={opt.amount_ml ?? undefined} volumeUnit={volumeUnit} />
              )}
              {opt.notes_key && (
                <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)' }}>
                  {t(opt.notes_key as TranslationKey)}
                </div>
              )}
              {opt.side_effect && (
                <SideEffectLine side={opt.side_effect} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// A product's secondary-parameter shift (issue #40): the translated caveat plus the
// signed estimate. pH shifts carry no unit; everything else is ppm.
function SideEffectLine({ side }: { side: NonNullable<DosageOption['side_effect']> }) {
  const { t } = useT()
  const sign = side.delta >= 0 ? '+' : '−'
  const magnitude = Math.abs(side.delta)
  const unit = side.param === 'ph' ? '' : ' ppm'
  return (
    <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)' }}>
      {t(side.notes_key as TranslationKey)} ({sign}{magnitude}{unit})
    </div>
  )
}

function AmountLine({ grams, mL, volumeUnit }: { grams?: number; mL?: number; volumeUnit: 'L' | 'gal' }) {
  const display = grams !== undefined ? gramsToDisplay(grams, volumeUnit) : mlToDisplay(mL as number, volumeUnit)
  return (
    <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
      {display.value} {display.unit === 'fl_oz' ? 'fl oz' : display.unit}
    </div>
  )
}

function HeatingTab({
  installationVolume, volumeUnit, tempUnit, tempRange, measuredTemp,
}: {
  installationVolume?: number
  volumeUnit: 'L' | 'gal'
  tempUnit: 'C' | 'F'
  tempRange?: ParamBand
  measuredTemp: number | null
}) {
  const { t } = useT()
  const guidanceBounds = PARAM_GUIDANCE.temp.bounds
  const band: ParamBand = tempRange ?? { ideal: guidanceBounds, acceptable: guidanceBounds }
  const [min, max] = band.acceptable
  const [idealMin, idealMax] = band.ideal
  const idealMid = (idealMin + idealMax) / 2

  const [currentTemp, setCurrentTemp] = useState(measuredTemp ?? idealMid)
  const [targetTemp, setTargetTemp] = useState(idealMid)
  const [volume, setVolume] = useState(installationVolume != null ? String(installationVolume) : '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<HeatingResult | null>(null)

  useEffect(() => {
    setCurrentTemp(measuredTemp ?? idealMid)
    setTargetTemp(idealMid)
    setResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idealMin, idealMax, measuredTemp])

  async function handleCalculate() {
    setError(null)
    setResult(null)
    const volumeValue = parseFloat(volume)
    if (isNaN(volumeValue)) {
      setError(t('simulator_dosage_error_generic'))
      return
    }
    const volumeL = volumeUnit === 'gal' ? volumeValue * GAL_TO_L : volumeValue
    const toCelsius = displayToMetricConverter('temp', { temp_unit: tempUnit })
    const currentC = toCelsius ? toCelsius(currentTemp) : currentTemp
    const targetC = toCelsius ? toCelsius(targetTemp) : targetTemp

    setLoading(true)
    try {
      const res = await fetch('/api/simulate/heating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ volume_L: volumeL, current_temp_c: currentC, target_temp_c: targetC }),
      })
      if (!res.ok) { setError(t('simulator_dosage_error_generic')); return }
      setResult(await res.json())
    } catch {
      setError(t('simulator_dosage_error_generic'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <ParamSlider
        label={t('simulator_heating_current_temp_label')}
        unit={`°${tempUnit}`}
        min={min} max={max} step={0.5}
        idealMin={idealMin} idealMax={idealMax}
        value={currentTemp}
        onChange={setCurrentTemp}
      />
      <ParamSlider
        label={t('simulator_heating_target_temp_label')}
        unit={`°${tempUnit}`}
        min={min} max={max} step={0.5}
        idealMin={idealMin} idealMax={idealMax}
        value={targetTemp}
        onChange={setTargetTemp}
      />

      <div style={sectionStyle}>
        <Label htmlFor="sim-heat-volume">{t('simulator_heating_volume_label')} ({volumeUnit})</Label>
        <Input id="sim-heat-volume" type="number" min="0" step="any" value={volume} onChange={e => setVolume(e.target.value)} />
      </div>

      {error && (
        <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)', margin: 0 }}>
          {error}
        </p>
      )}

      <Button type="button" onClick={handleCalculate} disabled={loading} className="w-full">
        {t('simulator_heating_calculate')}
      </Button>

      {result && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px',
          background: 'var(--bg-surface-2)', display: 'grid', gap: 4,
        }}>
          <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            {t('simulator_heating_result_label')}
          </div>
          <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            {result.kwh} kWh
          </div>
          <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)' }}>
            {t('simulator_heating_efficiency_note').replace('{pct}', String(Math.round(result.efficiency * 100)))}
          </div>
        </div>
      )}
    </div>
  )
}
