import { useState } from 'react'
import type { Action, Installation, Product } from '../types'
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
} from '../utils'
import { celsiusToFahrenheit, ppmToGramsPerLiter, ppmToGermanDegrees, ppmToFrenchDegrees, convertRange, formatUnitRange } from '../units'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import type { TranslationKey } from '../i18n/translations'

// ── Constants ──────────────────────────────────────────────────────────────

const ACTION_TYPES_POOL = [
  'Cartridge cleaning',
  'Skimmer filter cleaning',
  'Measurement',
  'pH calibration',
  'Add product',
]
const ACTION_TYPES_SPA = [
  'Cartridge cleaning',
  'Purge',
  'Water change',
  'Measurement',
  'pH calibration',
  'Add product',
]

/** DB-stored/matched raw action-type strings never change — only the rendered label does. */
export const ACTION_TYPE_LABELS: Record<string, TranslationKey> = {
  'Cartridge cleaning': 'action_type_nettoyage_cartouche',
  'Skimmer filter cleaning': 'action_type_nettoyage_filtre_skimmer',
  'Backwash': 'action_type_contre_lavage',
  'Measurement': 'action_type_mesure',
  'pH calibration': 'action_type_calibrage_ph',
  'Add product': 'action_type_ajout_produit',
  'Purge': 'action_type_purge',
  'Water change': 'action_type_changement_eau',
}

const UNITS = ['g', 'ml', 'pastille', 'L']
const PRODUCT_OPTIONS = [
  'Chlorine', 'Bromine', 'pH -', 'pH +', 'Salt',
  'Flocculant', 'Algaecide', 'Chlorine shock', 'Bromine shock',
]

/** DB-stored/matched raw product names never change — only the rendered label does. */
export const PRODUCT_LABELS: Record<string, TranslationKey> = {
  'Chlorine': 'modal_install_chlore',
  'Bromine': 'modal_install_brome',
  'pH -': 'product_ph_moins',
  'pH +': 'product_ph_plus',
  'Salt': 'modal_install_sel',
  'Flocculant': 'product_floculant',
  'Algaecide': 'product_anti_algue',
  'Chlorine shock': 'product_chlore_choc',
  'Bromine shock': 'product_brome_choc',
}

const QUICK_TAGS_POOL = [
  'Clear water', 'Level OK', 'Skimmer clean', 'Basket emptied',
  'Robot run', 'Backwash done', 'Vacuumed', 'Skimmed',
]
const QUICK_TAGS_SPA = [
  'Clear water', 'Level OK', 'Filters clean', 'Basket emptied',
  'Cover replaced', 'Purge done', 'Shell cleaning', 'Skimmed',
]

/** DB-stored/matched raw quick-tag strings (stored in notes free-text) never change — only the rendered label does. */
export const QUICK_TAG_LABELS: Record<string, TranslationKey> = {
  'Clear water': 'eau_claire',
  'Level OK': 'tag_niveau_ok',
  'Skimmer clean': 'tag_skimmer_propre',
  'Basket emptied': 'tag_panier_vide',
  'Robot run': 'tag_robot_passe',
  'Backwash done': 'tag_backwash_fait',
  'Vacuumed': 'tag_aspirateur_passe',
  'Skimmed': 'tag_epuisette_passee',
  'Filters clean': 'tag_filtres_propres',
  'Cover replaced': 'tag_couvercle_remis',
  'Purge done': 'tag_purge_faite',
  'Shell cleaning': 'tag_nettoyage_coque',
}

// ── ActionRow type ─────────────────────────────────────────────────────────

type ActionRow = {
  key: string
  action_type: string
  product_name: string | null
  qty: string
  unit: string
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

function makeRow(actionTypes: string[]): ActionRow {
  return {
    key: Math.random().toString(36).slice(2),
    action_type: actionTypes[0],
    product_name: null,
    qty: '',
    unit: UNITS[0],
    m_ph: '',
    m_bromine: '',
    m_chlorine: '',
    m_tac: '',
    m_hardness: '',
    m_salt: '',
    m_stabilizer: '',
    m_cc: '',
    m_temp: '',
  }
}

function rowFromAction(action: Action, products: Product[]): ActionRow {
  const product = products.find(p => p.id === action.product_id)
  const base: ActionRow = {
    key: 'edit',
    action_type: action.action_type,
    product_name: product?.name ?? null,
    qty: action.qty,
    unit: action.unit || UNITS[0],
    m_ph: '',
    m_bromine: '',
    m_chlorine: '',
    m_tac: '',
    m_hardness: '',
    m_salt: '',
    m_stabilizer: '',
    m_cc: '',
    m_temp: '',
  }
  if (action.action_type === 'Measurement' || action.action_type === 'pH Measurement') {
    base.action_type = 'Measurement'
    base.m_ph = action.qty
    const bromeM = action.notes.match(RX_BROMINE)
    if (bromeM) base.m_bromine = bromeM[1]
    const chloreM = action.notes.match(RX_CHLORINE)
    if (chloreM) base.m_chlorine = chloreM[1]
    const tacM = action.notes.match(RX_TAC)
    if (tacM) base.m_tac = tacM[1]
    const dureteM = action.notes.match(RX_HARDNESS)
    if (dureteM) base.m_hardness = dureteM[1]
    const selM = action.notes.match(RX_SALT)
    if (selM) base.m_salt = selM[1]
    const stabilisantM = action.notes.match(RX_STABILIZER)
    if (stabilisantM) base.m_stabilizer = stabilisantM[1]
    const ccM = action.notes.match(RX_CC)
    if (ccM) base.m_cc = ccM[1]
    const tempM = action.notes.match(RX_TEMP)
    if (tempM) base.m_temp = tempM[1]
  }
  return base
}

// ── Mode toggle (localStorage) ─────────────────────────────────────────────

type MeasureMode = 'bandelette' | 'appareil'

function readMode(): MeasureMode {
  try {
    const v = localStorage.getItem('pooly_mesure_mode')
    return v === 'appareil' ? 'appareil' : 'bandelette'
  } catch { return 'bandelette' }
}

function saveMode(m: MeasureMode) {
  try { localStorage.setItem('pooly_mesure_mode', m) } catch { /* ignore */ }
}

// ── Bandelette data ────────────────────────────────────────────────────────

type SwatchDef = { value: number; bg: string; textColor: string; border?: string }
type ZoneKind = 'low' | 'ok' | 'ideal' | 'high' | 'vhigh'
type ZoneDef = { label: string; flex: number; kind: ZoneKind }

type BandParam = {
  key: keyof Pick<ActionRow, 'm_ph' | 'm_bromine' | 'm_chlorine' | 'm_tac' | 'm_hardness'>
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
  key: 'm_tac', labelKey: 'band_tac_alcalinite',
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
  key: 'm_bromine', labelKey: 'param_brome',
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
  key: 'm_chlorine', labelKey: 'param_chlore',
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

const BAND_HARDNESS_BASE: BandParamBase = {
  key: 'm_hardness', labelKey: 'param_durete',
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
  const sanitizerBase = sanitizer === 'bromine' ? BAND_BROMINE_BASE : BAND_CHLORINE_BASE
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

// ── Bandelette mode component ──────────────────────────────────────────────

type BandeletteProps = {
  row: ActionRow
  onChange: (key: string, updates: Partial<ActionRow>) => void
  sanitizer: 'bromine' | 'chlorine' | 'salt'
}

function BandeletteMode({ row, onChange, sanitizer }: BandeletteProps) {
  const { t } = useT()
  const [hovered, setHovered] = useState<{ param: string; idx: number } | null>(null)
  const BAND_PARAMS = getBandParams(sanitizer, t)

  const summaryItems = BAND_PARAMS.flatMap(p => {
    const v = parseFloat(row[p.key])
    if (isNaN(v)) return []
    const kind = swatchZone(p, v)
    return [{ label: p.summaryFmt(v), ...pillStyle(kind) }]
  })

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Instruction */}
      <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
        {t('modal_comparez')}
      </div>

      {BAND_PARAMS.map(p => {
        const selValue = parseFloat(row[p.key])
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
                    onClick={() => onChange(row.key, { [p.key]: isSelected ? '' : String(s.value) })}
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
            {t('modal_resume')}
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

type AppareilField = {
  key: keyof Pick<ActionRow, 'm_ph' | 'm_bromine' | 'm_chlorine' | 'm_tac' | 'm_hardness' | 'm_salt' | 'm_stabilizer' | 'm_cc' | 'm_temp'>
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
 * units (conc_unit/temp_unit/salt_unit/durete_unit), and ideal-range numbers prefer the
 * installation's admin-configured `ranges` (fetched from the backend) over the hardcoded
 * PARAM_RANGES default — same fallback pattern as getPhStatus/getSaltStatus/etc, so the
 * hint text and the live border-color validation never contradict each other.
 */
function getAppareilFields(
  sanitizer: 'bromine' | 'chlorine' | 'salt',
  t: (key: TranslationKey) => string,
  installation?: Installation | null,
  ranges?: DynamicRanges,
): AppareilField[] {
  const tempUnit = installation?.temp_unit ?? 'C'
  const concUnit = installation?.conc_unit ?? 'mg/L'
  const saltUnit = installation?.salt_unit ?? 'ppm'
  const hardnessUnit = installation?.durete_unit ?? 'ppm'

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

  const phField: AppareilField = { key: 'm_ph', label: t('param_ph'), placeholder: '7.2', step: '0.1', hint: idealHint(t, phIdeal.ideal) }
  const chlorineField: AppareilField = { key: 'm_chlorine', label: t('param_chlore'), placeholder: '1.5', step: '0.5', hint: idealHint(t, chlorineIdeal.ideal, concUnit), unit: concUnit }
  const tacField: AppareilField = { key: 'm_tac', label: t('param_tac'), placeholder: '120', step: '5', hint: idealHint(t, tacIdeal.ideal, concUnit), unit: concUnit }
  const hardnessField: AppareilField = { key: 'm_hardness', label: t('param_durete'), placeholder: '250', step: '10', hint: idealHint(t, hardnessIdeal, hardnessUnit), unit: hardnessUnit }
  const ccField: AppareilField = { key: 'm_cc', label: t('param_cc'), placeholder: '0.1', step: '0.1', hint: idealHint(t, ccIdeal.ideal, concUnit), unit: concUnit }
  const tempPlaceholder = tempUnit === 'F' ? String(Math.round(celsiusToFahrenheit(25))) : '25'
  const tempField: AppareilField = { key: 'm_temp', label: t('param_temperature'), placeholder: tempPlaceholder, step: '0.5', hint: idealHint(t, tempIdeal, `°${tempUnit}`), unit: `°${tempUnit}` }

  if (sanitizer === 'bromine') {
    return [
      phField,
      { key: 'm_bromine', label: t('param_brome'), placeholder: '3.0', step: '0.5', hint: idealHint(t, bromineIdeal.ideal, concUnit), unit: concUnit },
      tacField,
      hardnessField,
      tempField,
    ]
  }
  if (sanitizer === 'salt') {
    return [
      phField,
      { key: 'm_salt', label: t('param_sel'), placeholder: '3000', step: '50', hint: idealHint(t, saltIdeal, saltUnit), unit: saltUnit },
      chlorineField,
      tacField,
      hardnessField,
      { key: 'm_stabilizer', label: t('param_stabilisant'), placeholder: '70', step: '5', hint: idealHint(t, stabilizerIdeal.ideal, 'ppm'), unit: 'ppm' },
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

function getAppareilStatus(key: AppareilField['key'], value: string, ranges?: DynamicRanges): FieldStatus {
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

type AppareilProps = {
  row: ActionRow
  onChange: (key: string, updates: Partial<ActionRow>) => void
  sanitizer: 'bromine' | 'chlorine' | 'salt'
}

function AppareilMode({ row, onChange, sanitizer }: AppareilProps) {
  const { t } = useT()
  const { active, ranges } = useInstallation()
  const APPAREIL_FIELDS = getAppareilFields(sanitizer, t, active, ranges ?? undefined)
  const [touched, setTouched] = useState<Partial<Record<AppareilField['key'], boolean>>>({})
  const touch = (k: AppareilField['key']) => setTouched(prev => ({ ...prev, [k]: true }))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {APPAREIL_FIELDS.map(f => {
        const val = row[f.key]
        const status = touched[f.key] ? getAppareilStatus(f.key, val, ranges ?? undefined) : null
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
                onChange={e => onChange(row.key, { [f.key]: e.target.value })}
                onBlur={() => touch(f.key)}
              />
              {f.unit && (
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)', pointerEvents: 'none' }}>
                  {f.unit}
                </span>
              )}
            </div>
            <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: status === 'bad' ? 'var(--status-danger-text)' : 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
              {status === 'bad' ? t('modal_valeur_hors_norme') : f.hint}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── MeasureSection (toggle + dispatch) ────────────────────────────────────

type MeasureSectionProps = {
  row: ActionRow
  onChange: (key: string, updates: Partial<ActionRow>) => void
  sanitizer: 'bromine' | 'chlorine' | 'salt'
}

function MeasureSection({ row, onChange, sanitizer }: MeasureSectionProps) {
  const { t } = useT()
  const [mode, setMode] = useState<MeasureMode>(readMode)

  const switchMode = (m: MeasureMode) => { setMode(m); saveMode(m) }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Toggle */}
      <div style={{ display: 'flex', background: 'var(--bg-surface-2)', borderRadius: 8, padding: 3, gap: 2 }}>
        {([['bandelette', t('modal_bandelette')], ['appareil', t('modal_appareil')]] as [MeasureMode, string][]).map(([m, label]) => {
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
      {mode === 'bandelette'
        ? <BandeletteMode row={row} onChange={onChange} sanitizer={sanitizer} />
        : <AppareilMode row={row} onChange={onChange} sanitizer={sanitizer} />
      }
    </div>
  )
}

// ── ActionRowItem ──────────────────────────────────────────────────────────

type RowItemProps = {
  row: ActionRow
  onChange: (key: string, updates: Partial<ActionRow>) => void
  onRemove: (key: string) => void
  canRemove: boolean
  products: Product[]
  actionTypes: string[]
  sanitizer: 'bromine' | 'chlorine' | 'salt'
}

function ActionRowItem({ row, onChange, onRemove, canRemove, actionTypes, sanitizer }: RowItemProps) {
  const { t } = useT()
  const showProduct = row.action_type === 'Add product'
  const showMeasure = row.action_type === 'Measurement'

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', background: 'var(--bg-surface-2)', display: 'grid', gap: 10 }}>
      {/* Action type + remove */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Select
          value={row.action_type}
          onValueChange={v => onChange(row.key, {
            action_type: v,
            product_name: null, qty: '', unit: UNITS[0],
            m_ph: '', m_bromine: '', m_chlorine: '', m_tac: '', m_hardness: '',
            m_salt: '', m_stabilizer: '', m_cc: '', m_temp: '',
          })}
        >
          <SelectTrigger style={{ flex: 1 }}><SelectValue /></SelectTrigger>
          <SelectContent>
            {actionTypes.map(a => <SelectItem key={a} value={a}>{translateLabel(t, ACTION_TYPE_LABELS, a)}</SelectItem>)}
          </SelectContent>
        </Select>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(row.key)}
            aria-label={t('modal_supprimer_action_aria')}
            style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}
          >×</button>
        )}
      </div>

      {showMeasure && <MeasureSection row={row} onChange={onChange} sanitizer={sanitizer} />}

      {showProduct && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 72px', gap: 8 }}>
          <Select
            value={row.product_name ?? 'none'}
            onValueChange={v => {
              const next = v === 'none' ? null : v
              onChange(row.key, { product_name: next, unit: next === 'Bromine' ? 'pastille' : row.unit === 'pastille' ? UNITS[0] : row.unit })
            }}
          >
            <SelectTrigger><SelectValue placeholder={t('modal_produit_placeholder')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('modal_produit_placeholder')}</SelectItem>
              {PRODUCT_OPTIONS.map(p => <SelectItem key={p} value={p}>{translateLabel(t, PRODUCT_LABELS, p)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="number" value={row.qty} onChange={e => onChange(row.key, { qty: e.target.value })} placeholder={t('modal_qte_placeholder')} />
          <Select value={row.unit} onValueChange={v => onChange(row.key, { unit: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}

// ── ActionForm ─────────────────────────────────────────────────────────────

type Props = {
  onAdd?: (actions: Omit<Action, 'id' | 'created_at' | 'user_id'>[]) => void
  products: Product[]
  onClose?: () => void
  editAction?: Action
  onEdit?: (id: number, data: Omit<Action, 'id' | 'created_at' | 'user_id'>) => void
}

export default function ActionForm({ onAdd, products: _products, onClose, editAction, onEdit }: Props) {
  const { t } = useT()
  const { active } = useInstallation()
  const sanitizer = active?.sanitizer ?? 'chlorine'
  const installationType = active?.type ?? 'pool'
  const actionTypes = installationType === 'spa' ? ACTION_TYPES_SPA : ACTION_TYPES_POOL
  const quickTags = installationType === 'spa' ? QUICK_TAGS_SPA : QUICK_TAGS_POOL

  const isEditMode = !!editAction
  const today = new Date().toISOString().slice(0, 10)

  const [date, setDate] = useState(editAction?.date ?? today)
  const [rows, setRows] = useState<ActionRow[]>(() =>
    editAction ? [rowFromAction(editAction, _products)] : [makeRow(actionTypes)]
  )
  const [notes, setNotes] = useState(() => {
    if (!editAction) return ''
    if (editAction.action_type === 'Measurement' || editAction.action_type === 'pH Measurement') {
      return editAction.notes
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
    return editAction.notes
  })
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    quickTags.filter(tag => (editAction?.notes ?? '').includes(tag))
  )
  const [measureError, setMeasureError] = useState(false)

  const updateRow = (key: string, updates: Partial<ActionRow>) => {
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...updates } : r))
    setMeasureError(false)
  }

  const addRow = () => setRows(prev => [...prev, makeRow(actionTypes)])
  const removeRow = (key: string) => setRows(prev => prev.filter(r => r.key !== key))

  const updateNotesWithTags = (selected: string[]) => {
    const allTags = [...QUICK_TAGS_POOL, ...QUICK_TAGS_SPA]
    let remaining = notes
    allTags.forEach(tag => {
      const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      remaining = remaining.replace(new RegExp(`\\b${escaped}\\b\\.?\\s*`, 'gi'), '')
    })
    remaining = remaining.trim()
    const prefix = selected.length > 0 ? selected.join('. ') : ''
    setNotes(prefix && remaining ? `${prefix}. ${remaining}` : `${prefix}${remaining}`.trim())
  }

  const toggleQuickTag = (tag: string) => {
    const next = selectedTags.includes(tag) ? selectedTags.filter(t => t !== tag) : [...selectedTags, tag]
    setSelectedTags(next)
    updateNotesWithTags(next)
  }

  const toPayload = (row: ActionRow) => {
    if (row.action_type === 'Measurement') {
      const parts: string[] = []
      if (row.m_bromine)  parts.push(`bromine: ${row.m_bromine}`)
      if (row.m_chlorine) parts.push(`chlorine: ${row.m_chlorine}`)
      if (row.m_tac)    parts.push(`TAC: ${row.m_tac}`)
      if (row.m_hardness) parts.push(`hardness: ${row.m_hardness}`)
      if (row.m_salt)    parts.push(`salt: ${row.m_salt}`)
      if (row.m_stabilizer) parts.push(`stabilizer: ${row.m_stabilizer}`)
      if (row.m_cc)     parts.push(`combined: ${row.m_cc}`)
      if (row.m_temp)   parts.push(`temperature: ${row.m_temp}`)
      const fullNotes = [parts.join('. '), notes].filter(Boolean).join('. ')
      return { date, action_type: 'Measurement', product_id: null, installation_id: active?.id ?? null, qty: row.m_ph, unit: '', notes: fullNotes }
    }
    const productId =
      row.action_type === 'Add product' && row.product_name
        ? _products.find(p => p.name.toLowerCase() === row.product_name!.toLowerCase())?.id ?? null
        : null
    return { date, action_type: row.action_type, product_id: productId, installation_id: active?.id ?? null, qty: row.qty, unit: row.unit, notes }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    for (const row of rows) {
      if (row.action_type === 'Measurement') {
        if (
          !row.m_ph && !row.m_bromine && !row.m_chlorine && !row.m_tac && !row.m_hardness &&
          !row.m_salt && !row.m_stabilizer && !row.m_cc && !row.m_temp
        ) {
          setMeasureError(true)
          return
        }
      }
    }
    if (isEditMode && editAction && onEdit) {
      onEdit(editAction.id, toPayload(rows[0]))
    } else if (onAdd) {
      onAdd(rows.map(toPayload))
    }
    onClose?.()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">

      {/* Corps scrollable */}
      <div className="flex-1 overflow-y-auto overscroll-contain grid gap-4">

        {/* Date */}
        <div style={{ display: 'grid', gap: 6 }}>
          <Label htmlFor="date">{t('modal_date')}</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
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

        {/* Action rows */}
        <div className="grid gap-2">
          <Label>{t('modal_actions')}</Label>
          {rows.map(row => (
            <ActionRowItem key={row.key} row={row} onChange={updateRow} onRemove={removeRow} canRemove={rows.length > 1} products={_products} actionTypes={actionTypes} sanitizer={sanitizer} />
          ))}
          {measureError && (
            <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)', margin: 0 }}>
              {t('modal_au_moins_un')}
            </p>
          )}
          {!isEditMode && (
            <button
              type="button"
              onClick={addRow}
              style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: '8px 14px', background: 'none', color: 'var(--pooly-primary)', fontSize: 13, fontFamily: '"Sora", sans-serif', fontWeight: 600, cursor: 'pointer', width: '100%', textAlign: 'left' }}
            >
              {t('modal_ajouter_action')}
            </button>
          )}
        </div>

        {/* Quick tags */}
        <div className="grid gap-2">
          <Label>{t('modal_statut_rapide')}</Label>
          <div className="grid grid-cols-2 gap-2">
            {quickTags.map(tag => (
              <label key={tag} className="flex items-center gap-2" style={{ fontFamily: '"Sora", sans-serif', color: 'var(--pooly-body)', fontSize: 13, textTransform: 'none', letterSpacing: 'normal' }}>
                <input type="checkbox" className="h-4 w-4" style={{ accentColor: 'var(--pooly-primary)' }} checked={selectedTags.includes(tag)} onChange={() => toggleQuickTag(tag)} />
                {translateLabel(t, QUICK_TAG_LABELS, tag)}
              </label>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="grid gap-1.5">
          <Label htmlFor="notes">{t('modal_notes')}</Label>
          <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('modal_notes_placeholder')} />
        </div>

      </div>

      {/* Footer fixe — toujours visible */}
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
          onClick={onClose}
          style={{
            padding: '10px 18px',
            borderRadius: '9px',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'Sora, sans-serif',
          }}
        >
          {t('modal_annuler')}
        </button>
        <button
          type="submit"
          style={{
            padding: '10px 22px',
            borderRadius: '9px',
            border: 'none',
            background: '#38bdf8',
            color: '#0a1f3c',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'Sora, sans-serif',
          }}
        >
          {isEditMode ? t('modal_enregistrer_modifs') : rows.length > 1 ? `${t('modal_enregistrer')} (${rows.length})` : t('modal_enregistrer')}
        </button>
      </div>

    </form>
  )
}
