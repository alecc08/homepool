import { useEffect, useMemo, useState } from 'react'
import type { Action, Installation, MaintenanceTask, TreatmentProduct } from '../types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getPhStatus,
  getBromineStatus,
  getChlorineStatus,
  getTacStatus,
  getHardnessStatus,
  getSaltStatus,
  getStabilizerStatus,
  getCombinedChlorineStatus,
  getTempStatus,
  translateLabel,
  maintenanceOptions,
  MEASURE_ACTION_TYPES,
  PRODUCT_ACTION_TYPE,
  TREATMENT_UNITS,
  treatmentProductLabel,
  PARAM_RANGES,
  RX_BROMINE,
  RX_CHLORINE,
  RX_TAC,
  RX_HARDNESS,
  RX_SALT,
  RX_STABILIZER,
  RX_CC,
  RX_TEMP,
  type DynamicRanges,
  type MaintenanceOption,
} from '../utils'
import { celsiusToFahrenheit, ppmToGramsPerLiter, ppmToGermanDegrees, ppmToFrenchDegrees, convertRange, formatUnitRange } from '../units'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import type { TranslationKey } from '../i18n/translations'

// ── Constants ──────────────────────────────────────────────────────────────

/** The raw action_type written for a water measurement. */
const MEASUREMENT_ACTION_TYPE = 'Measurement'

/** DB-stored/matched raw action-type strings never change — only the rendered label does. */
export const ACTION_TYPE_LABELS: Record<string, TranslationKey> = {
  'Cartridge cleaning': 'action_type_cartridge_cleaning',
  'Skimmer filter cleaning': 'action_type_skimmer_filter_cleaning',
  'Backwash': 'action_type_backwash',
  'Measurement': 'action_type_measurement',
  'pH calibration': 'action_type_ph_calibration',
  'Add product': 'action_type_add_product',
  'Purge': 'action_type_purge',
  'Water change': 'action_type_water_change',
}

/** Legacy product names, from before treatments had a per-installation catalog.
 * Nothing writes these any more — they exist so an old treatment still reads
 * back with a translated label in history. DB-stored raw names never change;
 * only the rendered label does. */
export const PRODUCT_LABELS: Record<string, TranslationKey> = {
  'Chlorine': 'modal_install_chlorine',
  'Bromine': 'modal_install_bromine',
  'pH -': 'product_ph_minus',
  'pH +': 'product_ph_plus',
  'Salt': 'modal_install_salt',
  'Flocculant': 'product_flocculant',
  'Algaecide': 'product_algaecide',
  'Chlorine shock': 'product_chlorine_shock',
  'Bromine shock': 'product_bromine_shock',
}

// ── Measured values ────────────────────────────────────────────────────────

type MeasureValues = {
  m_ph: string
  m_bromine: string
  m_chlorine: string
  m_tac: string
  m_hardness: string
  m_salt: string
  m_stabilizer: string
  m_cc: string
  m_temp: string
}

const EMPTY_MEASURE: MeasureValues = {
  m_ph: '', m_bromine: '', m_chlorine: '', m_tac: '',
  m_hardness: '', m_salt: '', m_stabilizer: '', m_cc: '', m_temp: '',
}

function isMeasurement(actionType: string): boolean {
  return MEASURE_ACTION_TYPES.includes(actionType)
}

function hasAnyValue(values: MeasureValues): boolean {
  return Object.values(values).some(v => v !== '')
}

/** Re-reads every measured field an action stored (pH from qty, the rest from
 * the `key: value` fields toPayload writes into notes) so edit mode round-trips. */
function measureFromAction(action: Action): MeasureValues {
  if (!isMeasurement(action.action_type)) return EMPTY_MEASURE
  const values: MeasureValues = { ...EMPTY_MEASURE, m_ph: action.qty }
  const notes = action.notes ?? ''
  const pairs: [keyof MeasureValues, RegExp][] = [
    ['m_bromine', RX_BROMINE],
    ['m_chlorine', RX_CHLORINE],
    ['m_tac', RX_TAC],
    ['m_hardness', RX_HARDNESS],
    ['m_salt', RX_SALT],
    ['m_stabilizer', RX_STABILIZER],
    ['m_cc', RX_CC],
    ['m_temp', RX_TEMP],
  ]
  for (const [key, rx] of pairs) {
    const match = notes.match(rx)
    if (match) values[key] = match[1]
  }
  return values
}

// ── Mode toggle (localStorage) ─────────────────────────────────────────────

type MeasureMode = 'strip' | 'manual'

const MEASURE_MODE_KEY = 'homepool_measure_mode'

/** Manual entry is the default (issue #51); the last mode the user picked is
 * remembered across sessions. 'device' is the legacy name for 'manual'. */
function readMode(): MeasureMode {
  try {
    return localStorage.getItem(MEASURE_MODE_KEY) === 'strip' ? 'strip' : 'manual'
  } catch { return 'manual' }
}

function saveMode(m: MeasureMode) {
  try { localStorage.setItem(MEASURE_MODE_KEY, m) } catch { /* ignore */ }
}

// ── Test-strip data ───────────────────────────────────────────────────────

type SwatchDef = { value: number; bg: string; textColor: string; border?: string }
type ZoneKind = 'low' | 'ok' | 'ideal' | 'high' | 'vhigh'
type ZoneDef = { label: string; flex: number; kind: ZoneKind }

type BandParam = {
  key: keyof Pick<MeasureValues, 'm_ph' | 'm_bromine' | 'm_chlorine' | 'm_tac' | 'm_hardness'>
  label: string
  summaryFmt: (v: number) => string
  swatches: SwatchDef[]
  zones: ZoneDef[]
}

/** Structural shape — swatches/zone kinds never change with locale. label/zone text is
 * computed fresh per call from `t`, via buildBandParam, since these aren't components. */
type BandParamBase = {
  key: BandParam['key']
  labelKey: TranslationKey
  summaryFmt: (v: number) => string
  swatches: SwatchDef[]
  zoneDefs: { flex: number; kind: ZoneKind }[]
}

const ZONE_LABEL_KEYS: Record<ZoneKind, TranslationKey> = {
  low: 'zone_low', ok: 'zone_ok', ideal: 'zone_ideal', high: 'zone_high', vhigh: 'zone_vhigh',
}

function buildBandParam(base: BandParamBase, t: (key: TranslationKey) => string): BandParam {
  return {
    key: base.key,
    label: t(base.labelKey),
    summaryFmt: base.summaryFmt,
    swatches: base.swatches,
    zones: base.zoneDefs.map(z => ({ label: t(ZONE_LABEL_KEYS[z.kind]), flex: z.flex, kind: z.kind })),
  }
}

const BAND_PH_BASE: BandParamBase = {
  key: 'm_ph', labelKey: 'param_ph',
  summaryFmt: v => `pH ${v.toFixed(1)}`,
  swatches: [
    { value: 6.2, bg: '#e8a020', textColor: 'rgba(255,255,255,0.8)' },
    { value: 6.8, bg: '#b8b020', textColor: 'rgba(255,255,255,0.8)' },
    { value: 7.2, bg: '#78b828', textColor: 'rgba(255,255,255,0.8)' },
    { value: 7.8, bg: '#38a878', textColor: 'rgba(255,255,255,0.8)' },
    { value: 8.4, bg: '#2878c0', textColor: 'rgba(255,255,255,0.8)' },
  ],
  zoneDefs: [
    { flex: 1, kind: 'low' },
    { flex: 3, kind: 'ok' },
    { flex: 1, kind: 'high' },
  ],
}

const BAND_TAC_BASE: BandParamBase = {
  key: 'm_tac', labelKey: 'band_tac_alkalinity',
  summaryFmt: v => `TAC ${v} mg/L`,
  swatches: [
    { value: 0,   bg: '#e8e050', textColor: 'rgba(0,0,0,0.45)' },
    { value: 40,  bg: '#98c840', textColor: 'rgba(255,255,255,0.8)' },
    { value: 80,  bg: '#48a030', textColor: 'rgba(255,255,255,0.8)' },
    { value: 120, bg: '#308060', textColor: 'rgba(255,255,255,0.8)' },
    { value: 180, bg: '#186858', textColor: 'rgba(255,255,255,0.8)' },
    { value: 240, bg: '#0a5050', textColor: 'rgba(255,255,255,0.8)' },
  ],
  zoneDefs: [
    { flex: 2, kind: 'low' },
    { flex: 3, kind: 'ok' },
    { flex: 1, kind: 'high' },
  ],
}

const BAND_BROMINE_BASE: BandParamBase = {
  key: 'm_bromine', labelKey: 'param_bromine',
  summaryFmt: v => `Bromine ${v} mg/L`,
  swatches: [
    { value: 0,  bg: '#f4f0e0', textColor: 'rgba(0,0,0,0.35)', border: '1px solid #e2e8f0' },
    { value: 1,  bg: '#e8e898', textColor: 'rgba(0,0,0,0.45)' },
    { value: 2,  bg: '#c8d850', textColor: 'rgba(0,0,0,0.45)' },
    { value: 5,  bg: '#80c040', textColor: 'rgba(255,255,255,0.8)' },
    { value: 10, bg: '#40a858', textColor: 'rgba(255,255,255,0.8)' },
    { value: 20, bg: '#208878', textColor: 'rgba(255,255,255,0.8)' },
  ],
  zoneDefs: [
    { flex: 2, kind: 'low' },
    { flex: 2, kind: 'ideal' },
    { flex: 1, kind: 'high' },
    { flex: 1, kind: 'vhigh' },
  ],
}

const BAND_CHLORINE_BASE: BandParamBase = {
  key: 'm_chlorine', labelKey: 'param_chlorine',
  summaryFmt: v => `Chlorine ${v} mg/L`,
  swatches: [
    { value: 0,   bg: '#f4f0e0', textColor: 'rgba(0,0,0,0.35)', border: '1px solid #e2e8f0' },
    { value: 0.5, bg: '#e8f898', textColor: 'rgba(0,0,0,0.45)' },
    { value: 1,   bg: '#c8e850', textColor: 'rgba(0,0,0,0.45)' },
    { value: 3,   bg: '#80c040', textColor: 'rgba(255,255,255,0.8)' },
    { value: 5,   bg: '#40a858', textColor: 'rgba(255,255,255,0.8)' },
    { value: 10,  bg: '#208878', textColor: 'rgba(255,255,255,0.8)' },
  ],
  zoneDefs: [
    { flex: 1, kind: 'low' },
    { flex: 2, kind: 'ideal' },
    { flex: 1, kind: 'high' },
    { flex: 2, kind: 'vhigh' },
  ],
}

// Salt pools are kept at a meaningfully higher CYA (60-80 ppm) than a manually-dosed
// chlorine pool, so the same AquaChek strip readings map to different zones: 3-5 ppm
// reads as low/borderline on a low-CYA pool but is the actual target here.
const BAND_CHLORINE_SALT_BASE: BandParamBase = {
  ...BAND_CHLORINE_BASE,
  zoneDefs: [
    { flex: 3, kind: 'low' },
    { flex: 2, kind: 'ideal' },
    { flex: 1, kind: 'vhigh' },
  ],
}

const BAND_HARDNESS_BASE: BandParamBase = {
  key: 'm_hardness', labelKey: 'param_hardness',
  summaryFmt: v => `Hardness ${v} ppm`,
  swatches: [
    { value: 0,    bg: '#a8c8e8', textColor: 'rgba(0,0,0,0.4)' },
    { value: 100,  bg: '#9090d0', textColor: 'rgba(255,255,255,0.8)' },
    { value: 250,  bg: '#8060b8', textColor: 'rgba(255,255,255,0.8)' },
    { value: 500,  bg: '#c050a0', textColor: 'rgba(255,255,255,0.8)' },
    { value: 1000, bg: '#e05080', textColor: 'rgba(255,255,255,0.8)' },
  ],
  zoneDefs: [
    { flex: 1, kind: 'low' },
    { flex: 3, kind: 'ok' },
    { flex: 1, kind: 'high' },
  ],
}

function getBandParams(sanitizer: 'bromine' | 'chlorine' | 'salt', t: (key: TranslationKey) => string): BandParam[] {
  const sanitizerBase = sanitizer === 'bromine' ? BAND_BROMINE_BASE : sanitizer === 'salt' ? BAND_CHLORINE_SALT_BASE : BAND_CHLORINE_BASE
  return [BAND_PH_BASE, BAND_TAC_BASE, sanitizerBase, BAND_HARDNESS_BASE].map(b => buildBandParam(b, t))
}

const ZONE_STYLE: Record<ZoneKind, { bg: string; color: string }> = {
  low:   { bg: 'var(--status-danger-bg)', color: 'var(--status-danger-text)' },
  ok:    { bg: 'var(--status-ok-bg)',     color: 'var(--status-ok-text)'     },
  ideal: { bg: 'var(--status-ok-bg)',     color: 'var(--status-ok-text)'     },
  high:  { bg: 'var(--status-warn-bg)',   color: 'var(--status-warn-text)'   },
  vhigh: { bg: 'var(--status-danger-bg)', color: 'var(--status-danger-text)' },
}

/** Get the zone kind for a given swatch value on a test-strip param. */
function swatchZone(param: BandParam, value: number): ZoneKind {
  const idx = param.swatches.findIndex(s => s.value === value)
  if (idx === -1) return 'ok'
  let start = 0
  for (const zone of param.zones) {
    if (idx < start + zone.flex) return zone.kind
    start += zone.flex
  }
  return 'ok'
}

/** Summary pill style from zone kind. */
function pillStyle(kind: ZoneKind): { color: string; bg: string } {
  return ZONE_STYLE[kind]
}

// ── Test-strip mode component ────────────────────────────────────────────

type StripProps = {
  values: MeasureValues
  onChange: (updates: Partial<MeasureValues>) => void
  sanitizer: 'bromine' | 'chlorine' | 'salt'
}

function StripMode({ values, onChange, sanitizer }: StripProps) {
  const { t } = useT()
  const [hovered, setHovered] = useState<{ param: string; idx: number } | null>(null)
  const BAND_PARAMS = getBandParams(sanitizer, t)

  const summaryItems = BAND_PARAMS.flatMap(p => {
    const v = parseFloat(values[p.key])
    if (isNaN(v)) return []
    const kind = swatchZone(p, v)
    return [{ label: p.summaryFmt(v), ...pillStyle(kind) }]
  })

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Instruction */}
      <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
        {t('modal_compare')}
      </div>

      {BAND_PARAMS.map(p => {
        const selValue = parseFloat(values[p.key])
        const hasSelection = !isNaN(selValue)

        return (
          <div key={p.key}>
            {/* Title + selected value */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {p.label}
              </span>
              <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                {hasSelection ? p.summaryFmt(selValue).replace(/^[^0-9]*/, '') || String(selValue) : '—'}
              </span>
            </div>

            {/* Swatches */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 5 }}>
              {p.swatches.map((s, idx) => {
                const isSelected = hasSelection && selValue === s.value
                const isHovered = hovered?.param === p.key && hovered.idx === idx
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => onChange({ [p.key]: isSelected ? '' : String(s.value) })}
                    onMouseEnter={() => setHovered({ param: p.key, idx })}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      flex: 1,
                      height: 34,
                      borderRadius: 6,
                      cursor: 'pointer',
                      border: isSelected
                        ? '2.5px solid var(--text-primary)'
                        : s.border || '2.5px solid transparent',
                      background: s.bg,
                      color: s.textColor,
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: 9,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'flex-end',
                      justifyContent: 'center',
                      paddingBottom: 4,
                      transition: 'transform 0.1s, box-shadow 0.1s',
                      transform: isSelected
                        ? 'translateY(-3px)'
                        : isHovered ? 'translateY(-2px)' : 'none',
                      boxShadow: isSelected
                        ? '0 3px 8px rgba(0,0,0,0.18)'
                        : 'none',
                    }}
                  >
                    {s.value}
                  </button>
                )
              })}
            </div>

            {/* Zone bar */}
            <div style={{ display: 'flex', height: 18, gap: 2, borderRadius: 6, overflow: 'hidden' }}>
              {p.zones.map(z => (
                <div
                  key={z.label}
                  style={{
                    flex: z.flex,
                    background: ZONE_STYLE[z.kind].bg,
                    color: ZONE_STYLE[z.kind].color,
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 9,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 4,
                  }}
                >
                  {z.label}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Summary */}
      {summaryItems.length > 0 && (
        <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
          <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 }}>
            {t('modal_summary')}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {summaryItems.map(item => (
              <span
                key={item.label}
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 10, fontWeight: 600,
                  color: item.color, background: item.bg,
                  padding: '2px 7px', borderRadius: 4,
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Digital device mode ─────────────────────────────────────────────────────

type DeviceField = {
  key: keyof MeasureValues
  label: string
  placeholder: string
  step: string
  hint: string
  unit?: string
}

/** Builds the `Ideal: X – Y [unit]` hint, trimming the trailing space when there's no unit. */
function idealHint(t: (key: TranslationKey) => string, ideal: [number, number], unit?: string): string {
  const range = formatUnitRange(ideal)
  return unit ? `${t('modal_ideal_prefix')} ${range} ${unit}` : `${t('modal_ideal_prefix')} ${range}`
}

/**
 * Field defs are computed per-installation: unit/hint reflect the installation's chosen
 * units (conc_unit/temp_unit/salt_unit/hardness_unit), and ideal-range numbers prefer the
 * installation's admin-configured `ranges` (fetched from the backend) over the hardcoded
 * PARAM_RANGES default — same fallback pattern as getPhStatus/getSaltStatus/etc, so the
 * hint text and the live border-color validation never contradict each other.
 */
function getDeviceFields(
  sanitizer: 'bromine' | 'chlorine' | 'salt',
  t: (key: TranslationKey) => string,
  installation?: Installation | null,
  ranges?: DynamicRanges,
): DeviceField[] {
  const tempUnit = installation?.temp_unit ?? 'C'
  const concUnit = installation?.conc_unit ?? 'mg/L'
  const saltUnit = installation?.salt_unit ?? 'ppm'
  const hardnessUnit = installation?.hardness_unit ?? 'ppm'

  const phIdeal = ranges?.ph ?? PARAM_RANGES.ph
  const tacIdeal = ranges?.tac ?? PARAM_RANGES.tac
  const ccIdeal = ranges?.cc ?? PARAM_RANGES.cc
  const bromineIdeal = ranges?.bromine ?? PARAM_RANGES.bromine
  const chlorineIdeal = ranges?.chlorine ?? PARAM_RANGES.chlorine
  const stabilizerIdeal = ranges?.stabilizer ?? PARAM_RANGES.stabilizer

  const tempIdeal: [number, number] = ranges?.temp?.ideal ?? (tempUnit === 'F'
    ? convertRange(PARAM_RANGES.temp, celsiusToFahrenheit).ideal
    : PARAM_RANGES.temp.ideal)
  const saltIdeal: [number, number] = ranges?.salt?.ideal ?? (saltUnit === 'g/L'
    ? convertRange(PARAM_RANGES.salt, ppmToGramsPerLiter).ideal
    : PARAM_RANGES.salt.ideal)
  const hardnessIdeal: [number, number] = ranges?.hardness?.ideal ?? (hardnessUnit === '°dH'
    ? convertRange(PARAM_RANGES.hardness, ppmToGermanDegrees).ideal
    : hardnessUnit === '°f'
      ? convertRange(PARAM_RANGES.hardness, ppmToFrenchDegrees).ideal
      : PARAM_RANGES.hardness.ideal)

  const phField: DeviceField = { key: 'm_ph', label: t('param_ph'), placeholder: '7.2', step: '0.1', hint: idealHint(t, phIdeal.ideal) }
  const chlorineField: DeviceField = { key: 'm_chlorine', label: t('param_chlorine'), placeholder: '1.5', step: '0.5', hint: idealHint(t, chlorineIdeal.ideal, concUnit), unit: concUnit }
  const tacField: DeviceField = { key: 'm_tac', label: t('param_tac'), placeholder: '120', step: '5', hint: idealHint(t, tacIdeal.ideal, concUnit), unit: concUnit }
  const hardnessField: DeviceField = { key: 'm_hardness', label: t('param_hardness'), placeholder: '250', step: '10', hint: idealHint(t, hardnessIdeal, hardnessUnit), unit: hardnessUnit }
  const ccField: DeviceField = { key: 'm_cc', label: t('param_cc'), placeholder: '0.1', step: '0.1', hint: idealHint(t, ccIdeal.ideal, concUnit), unit: concUnit }
  const tempPlaceholder = tempUnit === 'F' ? String(Math.round(celsiusToFahrenheit(25))) : '25'
  const tempField: DeviceField = { key: 'm_temp', label: t('param_temp_label'), placeholder: tempPlaceholder, step: '0.5', hint: idealHint(t, tempIdeal, `°${tempUnit}`), unit: `°${tempUnit}` }

  if (sanitizer === 'bromine') {
    return [
      phField,
      { key: 'm_bromine', label: t('param_bromine'), placeholder: '3.0', step: '0.5', hint: idealHint(t, bromineIdeal.ideal, concUnit), unit: concUnit },
      tacField,
      hardnessField,
      tempField,
    ]
  }
  if (sanitizer === 'salt') {
    return [
      phField,
      { key: 'm_salt', label: t('param_salt'), placeholder: '3000', step: '50', hint: idealHint(t, saltIdeal, saltUnit), unit: saltUnit },
      chlorineField,
      tacField,
      hardnessField,
      { key: 'm_stabilizer', label: t('param_stabilizer'), placeholder: '70', step: '5', hint: idealHint(t, stabilizerIdeal.ideal, 'ppm'), unit: 'ppm' },
      ccField,
      tempField,
    ]
  }
  return [
    phField,
    chlorineField,
    tacField,
    hardnessField,
    ccField,
    tempField,
  ]
}

type FieldStatus = 'normal' | 'warn' | 'bad' | null

function getDeviceStatus(key: DeviceField['key'], value: string, ranges?: DynamicRanges): FieldStatus {
  if (!value.trim()) return null
  const n = parseFloat(value)
  if (isNaN(n)) return null
  const fn = {
    m_ph: getPhStatus,
    m_bromine: getBromineStatus,
    m_chlorine: getChlorineStatus,
    m_tac: getTacStatus,
    m_hardness: getHardnessStatus,
    m_salt: getSaltStatus,
    m_stabilizer: getStabilizerStatus,
    m_cc: getCombinedChlorineStatus,
    m_temp: getTempStatus,
  }[key]
  return fn(n, ranges)
}

const STATUS_BORDER: Record<NonNullable<FieldStatus>, string> = {
  normal: 'var(--status-ok-text)', warn: 'var(--status-warn-text)', bad: 'var(--status-danger-text)',
}

type DeviceProps = {
  values: MeasureValues
  onChange: (updates: Partial<MeasureValues>) => void
  sanitizer: 'bromine' | 'chlorine' | 'salt'
}

function DeviceMode({ values, onChange, sanitizer }: DeviceProps) {
  const { t } = useT()
  const { active, ranges } = useInstallation()
  const DEVICE_FIELDS = getDeviceFields(sanitizer, t, active, ranges ?? undefined)
  const [touched, setTouched] = useState<Partial<Record<DeviceField['key'], boolean>>>({})
  const touch = (k: DeviceField['key']) => setTouched(prev => ({ ...prev, [k]: true }))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {DEVICE_FIELDS.map(f => {
        const val = values[f.key]
        const status = touched[f.key] ? getDeviceStatus(f.key, val, ranges ?? undefined) : null
        const border = status ? STATUS_BORDER[status] : 'var(--border)'
        return (
          <div key={f.key}>
            <label style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
              {f.label}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                step={f.step}
                value={val}
                placeholder={f.placeholder}
                style={{
                  background: 'var(--bg-surface-2)', border: `1px solid ${border}`, borderRadius: 8,
                  fontFamily: '"Sora", sans-serif', fontSize: 13,
                  padding: f.unit ? '9px 44px 9px 13px' : '9px 13px',
                  width: '100%', outline: 'none', boxSizing: 'border-box' as const,
                }}
                onChange={e => onChange({ [f.key]: e.target.value })}
                onBlur={() => touch(f.key)}
              />
              {f.unit && (
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)', pointerEvents: 'none' }}>
                  {f.unit}
                </span>
              )}
            </div>
            <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: status === 'bad' ? 'var(--status-danger-text)' : 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
              {status === 'bad' ? t('modal_value_out_of_range') : f.hint}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── MeasureSection (toggle + dispatch) ────────────────────────────────────

type MeasureSectionProps = {
  values: MeasureValues
  onChange: (updates: Partial<MeasureValues>) => void
  sanitizer: 'bromine' | 'chlorine' | 'salt'
}

function MeasureSection({ values, onChange, sanitizer }: MeasureSectionProps) {
  const { t } = useT()
  const [mode, setMode] = useState<MeasureMode>(readMode)

  const switchMode = (m: MeasureMode) => { setMode(m); saveMode(m) }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Toggle */}
      <div style={{ display: 'flex', background: 'var(--bg-surface-2)', borderRadius: 8, padding: 3, gap: 2 }}>
        {([['manual', t('modal_manual')], ['strip', t('modal_strip')]] as [MeasureMode, string][]).map(([m, label]) => {
          const active = mode === m
          return (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              style={{
                flex: 1,
                fontFamily: '"Sora", sans-serif',
                fontSize: 11, fontWeight: 500,
                padding: '5px 8px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                background: active ? 'var(--bg-surface)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'background 0.12s, color 0.12s, box-shadow 0.12s',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Mode content */}
      {mode === 'strip'
        ? <StripMode values={values} onChange={onChange} sanitizer={sanitizer} />
        : <DeviceMode values={values} onChange={onChange} sanitizer={sanitizer} />
      }
    </div>
  )
}

// ── Maintenance section ────────────────────────────────────────────────────
//
// The choices are the installation's own enabled maintenance tasks (issue #51)
// — there is no separate action-type list any more. Tasks completed by taking a
// measurement (the built-in pH measurement) are excluded: those are logged from
// the measurement half of this form, which carries the values. So is adding a
// product: that is a treatment, logged from TreatmentSection below.

type MaintenanceSectionProps = {
  options: MaintenanceOption[]
  loading: boolean
  actionType: string
  onActionTypeChange: (actionType: string) => void
}

function MaintenanceSection({
  options, loading, actionType, onActionTypeChange,
}: MaintenanceSectionProps) {
  const { t } = useT()

  if (loading) {
    return (
      <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
        {t('ranges_loading')}
      </p>
    )
  }

  if (options.length === 0) {
    return (
      <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
        {t('modal_no_maintenance_tasks')}
      </p>
    )
  }

  return (
    <Select value={actionType || undefined} onValueChange={onActionTypeChange}>
      <SelectTrigger aria-label={t('modal_maintenance_type')}>
        <SelectValue placeholder={t('modal_maintenance_placeholder')} />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.action_type} value={option.action_type}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── Treatment section ──────────────────────────────────────────────────────
//
// Adding something to the water: which product, how much, and optionally the
// brand you actually bought. The choices are the installation's own enabled
// treatment products, configured under Installation › Treatments.

type TreatmentSectionProps = {
  products: TreatmentProduct[]
  loading: boolean
  treatmentId: number | null
  qty: string
  unit: string
  brand: string
  onChange: (updates: { treatment_id?: number | null; qty?: string; unit?: string; brand?: string }) => void
}

function TreatmentSection({
  products, loading, treatmentId, qty, unit, brand, onChange,
}: TreatmentSectionProps) {
  const { t } = useT()

  if (loading) {
    return (
      <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
        {t('ranges_loading')}
      </p>
    )
  }

  if (products.length === 0) {
    return (
      <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
        {t('modal_no_treatments')}
      </p>
    )
  }

  // A unit the entry already carries but that is no longer offered (an older
  // "pastille" row, say) is kept as a choice so editing can't silently rewrite it.
  const units = TREATMENT_UNITS.includes(unit) ? TREATMENT_UNITS : [unit, ...TREATMENT_UNITS]

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* '' rather than undefined for "nothing picked": undefined would make
          Radix treat the select as uncontrolled, and a product chosen for us
          later (a recommendation handing off a dose) would never show up. */}
      <Select
        value={treatmentId === null ? '' : String(treatmentId)}
        onValueChange={v => {
          // Radix echoes the empty value back once when a controlled select
          // goes from '' to a real id; Number('') would land on product 0.
          if (!v) return
          const next = Number(v)
          const picked = products.find(p => p.id === next)
          // Switching product re-seeds the unit, so picking "Bromine tablets"
          // doesn't leave you dosing grams.
          onChange({ treatment_id: next, unit: picked?.default_unit ?? unit })
        }}
      >
        <SelectTrigger aria-label={t('modal_treatment_product')}>
          <SelectValue placeholder={t('modal_treatment_placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {products.map(p => (
            <SelectItem key={p.id} value={String(p.id)}>{treatmentProductLabel(p, t)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 8 }}>
        <Input
          type="number"
          step="any"
          value={qty}
          onChange={e => onChange({ qty: e.target.value })}
          placeholder={t('modal_amount')}
          aria-label={t('modal_amount')}
        />
        <Select value={unit} onValueChange={v => onChange({ unit: v })}>
          <SelectTrigger aria-label={t('treat_unit_label')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {units.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Input
        value={brand}
        onChange={e => onChange({ brand: e.target.value })}
        placeholder={t('modal_brand_placeholder')}
        aria-label={t('modal_brand')}
      />
    </div>
  )
}

// ── Segmented toggle ───────────────────────────────────────────────────────

function SegmentedToggle<T extends string>({ value, options, onChange }: {
  value: T
  options: [T, string][]
  onChange: (value: T) => void
}) {
  return (
    <div style={{ display: 'flex', background: 'var(--bg-surface-2)', borderRadius: 8, padding: 3, gap: 2 }}>
      {options.map(([key, label]) => {
        const active = value === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            style={{
              flex: 1,
              fontFamily: '"Sora", sans-serif',
              fontSize: 11, fontWeight: 500,
              padding: '5px 8px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: active ? 'var(--bg-surface)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'background 0.12s, color 0.12s, box-shadow 0.12s',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ── ActionForm ─────────────────────────────────────────────────────────────

/** The three things you can log: a water measurement, a treatment (something
 * you added to the water, from the installation's product catalog), or a
 * maintenance entry (one of the installation's configured tasks). These are the
 * same three categories history has always shown. */
export type EntryKind = 'measurement' | 'treatment' | 'maintenance'

type NewAction = Omit<Action, 'id' | 'created_at' | 'user_id'>

/** Strips the structured `key: value` measurement fields toPayload writes into
 * notes, leaving only what the user actually typed. */
function stripMeasurementNotes(notes: string): string {
  return notes
    .replace(/bromine\s*(?:total)?\s*:\s*[\d.]+\.?\s*/gi, '')
    .replace(/chlorine?\s*(?:free)?\s*:\s*[\d.]+\.?\s*/gi, '')
    .replace(/TAC\s*:\s*[\d.]+\.?\s*/gi, '')
    .replace(/hardness\s*(?:total)?\s*:\s*[\d.]+\.?\s*/gi, '')
    .replace(/salt\s*:\s*[\d.]+\.?\s*/gi, '')
    .replace(/stabilizer\s*:\s*[\d.]+\.?\s*/gi, '')
    .replace(/combined\s*:\s*[\d.]+\.?\s*/gi, '')
    .replace(/temperature?\s*:\s*[\d.]+\.?\s*/gi, '')
    .replace(/^[\s.]+/, '')
    .trim()
}

type Props = {
  onAdd?: (action: NewAction) => void
  onClose?: () => void
  editAction?: Action
  onEdit?: (id: number, data: NewAction) => void
  /** Which third of the form a new entry opens on. Defaults to a measurement. */
  initialKind?: EntryKind
  /** Preselects a maintenance task's action type (e.g. when the maintenance
   * page hands one off). */
  initialActionType?: string
  /** Preselects a treatment and its amount — how the recommendations page hands
   * off "add 250 g of soda ash" as a ready-to-save entry. */
  initialTreatment?: TreatmentPrefill
}

/** A dose handed to the entry form from elsewhere. The product is matched on
 * its dosage_product_id rather than a row id: a caller looking at dosing advice
 * has no idea how this installation's catalog is numbered. */
export type TreatmentPrefill = {
  dosage_product_id: string
  qty?: string
  unit?: string
}

export default function ActionForm({
  onAdd, onClose, editAction, onEdit, initialKind, initialActionType,
  initialTreatment,
}: Props) {
  const { t } = useT()
  const { active } = useInstallation()
  const sanitizer = active?.sanitizer ?? 'chlorine'

  const isEditMode = !!editAction
  const editingMeasurement = editAction ? isMeasurement(editAction.action_type) : false
  const editingTreatment = editAction ? editAction.action_type === PRODUCT_ACTION_TYPE : false
  const today = new Date().toISOString().slice(0, 10)

  const editKind: EntryKind = editingMeasurement
    ? 'measurement'
    : editingTreatment ? 'treatment' : 'maintenance'
  const [kind, setKind] = useState<EntryKind>(() =>
    editAction ? editKind : (initialKind ?? 'measurement')
  )
  const [date, setDate] = useState(editAction?.date ?? today)
  const [values, setValues] = useState<MeasureValues>(() =>
    editAction ? measureFromAction(editAction) : EMPTY_MEASURE
  )
  const [actionType, setActionType] = useState(
    editAction ? (editingMeasurement || editingTreatment ? '' : editAction.action_type) : (initialActionType ?? '')
  )
  const [treatmentId, setTreatmentId] = useState<number | null>(editAction?.treatment_id ?? null)
  const [qty, setQty] = useState(() => {
    if (initialTreatment?.qty) return initialTreatment.qty
    return editAction && !editingMeasurement ? editAction.qty : ''
  })
  const [unit, setUnit] = useState(
    initialTreatment?.unit ?? editAction?.unit ?? TREATMENT_UNITS[0]
  )
  const [brand, setBrand] = useState(editAction?.brand ?? '')
  const [notes, setNotes] = useState(() => {
    if (!editAction) return ''
    return editingMeasurement ? stripMeasurementNotes(editAction.notes) : editAction.notes
  })
  const [error, setError] = useState<'measure' | 'task' | 'treatment' | null>(null)

  // The maintenance choices are the installation's configured tasks. A failed
  // load degrades to "no tasks" rather than blocking the measurement half.
  const [tasks, setTasks] = useState<MaintenanceTask[] | null>(null)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    fetch(`/api/installations/${active.id}/maintenance`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : []))
      .then((data: MaintenanceTask[]) => { if (!cancelled) setTasks(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setTasks([]) })
    return () => { cancelled = true }
  }, [active?.id])

  // Same for the treatment choices: the installation's own product catalog.
  const [treatments, setTreatments] = useState<TreatmentProduct[] | null>(null)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    fetch(`/api/installations/${active.id}/treatments`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : []))
      .then((data: TreatmentProduct[]) => { if (!cancelled) setTreatments(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setTreatments([]) })
    return () => { cancelled = true }
  }, [active?.id])

  const treatmentOptions = useMemo(() => {
    const enabled = (treatments ?? []).filter(p => p.enabled)
    // Editing an entry whose product has since been disabled must not silently
    // rewrite it — offer it as-is, the same way the maintenance picker does.
    const current = (treatments ?? []).find(p => p.id === treatmentId)
    if (current && !current.enabled) return [...enabled, current]
    return enabled
  }, [treatments, treatmentId])

  // The recommendations page hands off a dosage product id rather than a row id
  // — it has no idea how this installation's catalog is numbered. Resolve it
  // once the catalog lands.
  useEffect(() => {
    if (!initialTreatment || treatments === null || treatmentId !== null) return
    const match = treatments.find(
      p => p.enabled && p.dosage_product_id === initialTreatment.dosage_product_id
    )
    if (match) {
      setTreatmentId(match.id)
      if (!initialTreatment.unit) setUnit(match.default_unit)
    }
  }, [treatments, initialTreatment, treatmentId])

  const options = useMemo(() => {
    const fromTasks = maintenanceOptions(tasks ?? [], t)
    // Editing an entry whose type no longer matches an enabled task (a disabled
    // task, a secondary action type, a row from an older version) must not
    // silently rewrite it — offer it as-is.
    if (actionType && !fromTasks.some(o => o.action_type === actionType)) {
      return [...fromTasks, { action_type: actionType, label: translateLabel(t, ACTION_TYPE_LABELS, actionType) }]
    }
    return fromTasks
  }, [tasks, actionType, t])

  const updateValues = (updates: Partial<MeasureValues>) => {
    setValues(prev => ({ ...prev, ...updates }))
    setError(null)
  }

  const buildPayload = (): NewAction => {
    const installation_id = active?.id ?? null
    if (kind === 'measurement') {
      const parts: string[] = []
      if (values.m_bromine) parts.push(`bromine: ${values.m_bromine}`)
      if (values.m_chlorine) parts.push(`chlorine: ${values.m_chlorine}`)
      if (values.m_tac) parts.push(`TAC: ${values.m_tac}`)
      if (values.m_hardness) parts.push(`hardness: ${values.m_hardness}`)
      if (values.m_salt) parts.push(`salt: ${values.m_salt}`)
      if (values.m_stabilizer) parts.push(`stabilizer: ${values.m_stabilizer}`)
      if (values.m_cc) parts.push(`combined: ${values.m_cc}`)
      if (values.m_temp) parts.push(`temperature: ${values.m_temp}`)
      const fullNotes = [parts.join('. '), notes].filter(Boolean).join('. ')
      return {
        date, action_type: MEASUREMENT_ACTION_TYPE, product_id: null,
        treatment_id: null, installation_id, qty: values.m_ph, unit: '',
        brand: '', notes: fullNotes,
      }
    }
    if (kind === 'treatment') {
      // Treatments keep the historical action_type so every one ever logged —
      // including those from before treatments were their own kind — stays
      // classified the same way. The product lives in treatment_id.
      return {
        date, action_type: PRODUCT_ACTION_TYPE, product_id: null,
        treatment_id: treatmentId, installation_id, qty, unit, brand, notes,
      }
    }
    return {
      date, action_type: actionType, product_id: null, treatment_id: null,
      installation_id, qty: '', unit: '', brand: '', notes,
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (kind === 'measurement' && !hasAnyValue(values)) {
      setError('measure')
      return
    }
    if (kind === 'treatment' && treatmentId === null) {
      setError('treatment')
      return
    }
    if (kind === 'maintenance' && !actionType) {
      setError('task')
      return
    }
    const payload = buildPayload()
    if (isEditMode && editAction && onEdit) {
      onEdit(editAction.id, payload)
    } else {
      onAdd?.(payload)
    }
    onClose?.()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overscroll-contain grid gap-4">

        {/* Entry kind — a measurement, a treatment, or a configured maintenance task */}
        {!isEditMode && (
          <div style={{ display: 'grid', gap: 6 }}>
            <Label>{t('modal_entry_type')}</Label>
            <SegmentedToggle
              value={kind}
              options={[
                ['measurement', t('modal_kind_measurement')],
                ['treatment', t('modal_kind_treatment')],
                ['maintenance', t('modal_kind_maintenance')],
              ]}
              onChange={k => { setKind(k); setError(null) }}
            />
          </div>
        )}

        {/* Date */}
        <div style={{ display: 'grid', gap: 6 }}>
          <Label htmlFor="date">{t('modal_date')}</Label>
          {/* Backdate freely — this is how you record something you did days ago
              and forgot to log. Capped at today: a mistyped year would otherwise
              poison every derived due date. */}
          <Input
            id="date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            max={today}
            required
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 14,
              fontWeight: 500,
              width: 'auto',
              maxWidth: 180,
            }}
          />
        </div>

        {kind === 'measurement' ? (
          <div className="grid gap-2">
            <MeasureSection values={values} onChange={updateValues} sanitizer={sanitizer} />
            {error === 'measure' && (
              <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)', margin: 0 }}>
                {t('modal_at_least_one')}
              </p>
            )}
          </div>
        ) : kind === 'treatment' ? (
          <div className="grid gap-2">
            <Label>{t('modal_treatment_product')}</Label>
            <TreatmentSection
              products={treatmentOptions}
              loading={!!active && treatments === null}
              treatmentId={treatmentId}
              qty={qty}
              unit={unit}
              brand={brand}
              onChange={updates => {
                if (updates.treatment_id !== undefined) { setTreatmentId(updates.treatment_id); setError(null) }
                if (updates.qty !== undefined) setQty(updates.qty)
                if (updates.unit !== undefined) setUnit(updates.unit)
                if (updates.brand !== undefined) setBrand(updates.brand)
              }}
            />
            {error === 'treatment' && (
              <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)', margin: 0 }}>
                {t('modal_select_treatment')}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-2">
            <Label>{t('modal_maintenance_type')}</Label>
            <MaintenanceSection
              options={options}
              loading={!!active && tasks === null}
              actionType={actionType}
              onActionTypeChange={v => { setActionType(v); setError(null) }}
            />
            {error === 'task' && (
              <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)', margin: 0 }}>
                {t('modal_select_maintenance')}
              </p>
            )}
          </div>
        )}

        {/* Notes */}
        <div className="grid gap-1.5">
          <Label htmlFor="notes">{t('modal_notes')}</Label>
          <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('modal_notes_placeholder')} />
        </div>

      </div>

      {/* Fixed footer — always visible */}
      <div style={{
        flexShrink: 0,
        padding: '14px 0 0',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '10px',
      }}>
        <button
          type="button"
          className="btn-ghost"
          onClick={onClose}
        >
          {t('modal_cancel')}
        </button>
        <button
          type="submit"
          className="btn-primary"
        >
          {isEditMode ? t('modal_save_changes') : t('modal_save')}
        </button>
      </div>

    </form>
  )
}
