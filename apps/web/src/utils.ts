import type { Action, Installation, InstallationWaterParams, MaintenanceTask } from './types'
import { convertRange, metricToDisplayConverter } from './units'
import type { TranslationKey } from './i18n/translations'

// ── Water status ──────────────────────────────────────────────────────────────

export type WaterStatus = 'clear' | 'cloudy' | 'green'

// Salt, stabilizer (CYA), CC and hardness are tracked/displayed but deliberately
// excluded from the clear/cloudy/green heuristic below (same precedent as hardness).
export type WaterParams = {
  ph: number | null
  chlorine: number | null
  tac: number | null
  bromine?: number | null
}

/**
 * Per-installation range overrides. Each key is optional; absent keys fall back to PARAM_RANGES.
 */
export type DynamicRanges = {
  ph?: { ideal: [number, number]; acceptable: [number, number] }
  chlorine?: { ideal: [number, number]; acceptable: [number, number] }
  bromine?: { ideal: [number, number]; acceptable: [number, number] }
  tac?: { ideal: [number, number]; acceptable: [number, number] }
  temp?: { ideal: [number, number]; acceptable: [number, number] }
  salt?: { ideal: [number, number]; acceptable: [number, number] }
  stabilizer?: { ideal: [number, number]; acceptable: [number, number] }
  cc?: { ideal: [number, number]; acceptable: [number, number] }
  hardness?: { ideal: [number, number]; acceptable: [number, number] }
}

/**
 * Convert API InstallationWaterParams to DynamicRanges (cl→chlorine, br→bromine, salt→salt, cya→stabilizer).
 * When an installation is provided, temp/salt/hardness ranges are converted to the installation's
 * chosen unit ("store as entered" model — chlorine/bromine/tac/cc are display-label-only, no math).
 * hardness falls back to PARAM_RANGES.hardness only for combos that don't return one from the backend.
 */
export function installationParamsToRanges(params: InstallationWaterParams, installation?: Installation): DynamicRanges {
  const tempConvert = metricToDisplayConverter('temp', installation)
  const temp = tempConvert ? convertRange(params.temp, tempConvert) : params.temp

  const saltConvert = metricToDisplayConverter('salt', installation)
  const salt = saltConvert && params.salt ? convertRange(params.salt, saltConvert) : params.salt

  const hardnessBase = params.hardness ?? PARAM_RANGES.hardness
  const hardnessConvert = metricToDisplayConverter('hardness', installation)
  const hardness = hardnessConvert ? convertRange(hardnessBase, hardnessConvert) : hardnessBase

  return {
    ph: params.ph,
    tac: params.tac,
    temp,
    chlorine: params.cl,
    bromine: params.br,
    salt,
    stabilizer: params.cya,
    cc: params.cc,
    hardness,
  }
}

/** Centralised reference ranges. Use these everywhere — never duplicate. */
export const PARAM_RANGES = {
  ph:         { ideal: [7.0, 7.6]     as [number, number], acceptable: [6.8, 7.8]     as [number, number] },
  chlorine:   { ideal: [0.5, 3.0]     as [number, number], acceptable: [0.3, 4.0]     as [number, number] },
  tac:        { ideal: [80, 180]      as [number, number], acceptable: [60, 200]      as [number, number] },
  temp:       { ideal: [24, 28]       as [number, number], acceptable: [15, 35]       as [number, number] },
  bromine:    { ideal: [2, 5]         as [number, number], acceptable: [1, 10]        as [number, number] },
  hardness:   { ideal: [100, 500]     as [number, number], acceptable: [50, 1000]     as [number, number] },
  salt:       { ideal: [2700, 3400]   as [number, number], acceptable: [2500, 4500]   as [number, number] },
  stabilizer: { ideal: [60, 80]       as [number, number], acceptable: [30, 100]      as [number, number] },
  cc:         { ideal: [0, 0.2]       as [number, number], acceptable: [0, 0.5]       as [number, number] },
}

/**
 * Test-strip-specific OK thresholds — used for summary pills.
 * Source of truth shared between the form and getWaterStatus.
 */
export const STRIP_OK_RANGES = {
  ph:       PARAM_RANGES.ph.acceptable,
  tac:      PARAM_RANGES.tac.ideal,
  bromine:  PARAM_RANGES.bromine.ideal,
  hardness: PARAM_RANGES.hardness.ideal,
}

/** Action types that carry water-quality measurements. */
const MEASURE_ACTION_TYPES = ['pH Measurement', 'Measurement']

// ── Measurement-parsing regexes ─────────────────────────────────────────────
// Single source of truth for parsing the `key: value` measurement fields that
// toPayload (ActionForm.tsx) writes into `notes`. (\d+(?:\.\d+)?) — not [\d.]+ —
// so a value immediately followed by a sentence period (as toPayload always
// produces, e.g. "chlorine: 1.5. TAC: ...") captures cleanly without swallowing
// the trailing dot. RX_TEMP requires a literal ° for its shorthand branch (not
// an optional one) so it can't hijack the "t" in "stabilizer: 65".
const NUM = String.raw`(\d+(?:\.\d+)?)`
export const RX_CHLORINE = new RegExp(String.raw`chlorine?\s*(?:free)?\s*:?\s*${NUM}`, 'i')
export const RX_TAC = new RegExp(String.raw`TAC\s*:?\s*${NUM}`, 'i')
export const RX_HARDNESS = new RegExp(String.raw`hardness\s*(?:total)?\s*:?\s*${NUM}`, 'i')
export const RX_BROMINE = new RegExp(String.raw`bromine\s*(?:total)?\s*:?\s*${NUM}`, 'i')
export const RX_SALT = new RegExp(String.raw`salt\s*:?\s*${NUM}`, 'i')
export const RX_STABILIZER = new RegExp(String.raw`(?:stabilizer|cyanuric acid|cya)\s*:?\s*${NUM}`, 'i')
export const RX_CC = new RegExp(String.raw`combined\s*:?\s*${NUM}`, 'i')
export const RX_TEMP = new RegExp(String.raw`(?:temperature?|\bT°)\s*:?\s*${NUM}`, 'i')

/**
 * Pure function — returns the water status from measured parameters.
 * Priority: green > cloudy > clear.
 * hasData is false when no measurement has been recorded yet.
 */
export function getWaterStatus(params: WaterParams, ranges?: DynamicRanges): { status: WaterStatus; hasData: boolean } {
  const { ph, chlorine, tac, bromine = null } = params
  const hasData = ph !== null || chlorine !== null || tac !== null || bromine !== null

  if (!hasData) return { status: 'clear', hasData: false }

  const rph    = ranges?.ph       ?? PARAM_RANGES.ph
  const rcl    = ranges?.chlorine ?? PARAM_RANGES.chlorine
  const rbr    = ranges?.bromine  ?? PARAM_RANGES.bromine
  const rtac   = ranges?.tac      ?? PARAM_RANGES.tac

  // Green — most severe, checked first. TAC/alkalinity is deliberately excluded here:
  // an out-of-range TAC doesn't cause visually green/algae water (it's a balance
  // parameter, not a sanitizer), so it can only push status down to 'cloudy', never
  // trigger this tier. It's still surfaced via its own status pill on the Dashboard.
  if (
    (ph       !== null && !inRange(ph,       rph.acceptable))  ||
    (chlorine !== null && !inRange(chlorine, rcl.acceptable))  ||
    (bromine  !== null && !inRange(bromine,  rbr.acceptable))
  ) {
    return { status: 'green', hasData: true }
  }

  // Cloudy — TAC outside its ideal band lands here (this also covers a TAC outside its
  // acceptable band, since acceptable is always a superset of ideal).
  if (
    (ph       !== null && !inRange(ph,       rph.ideal))  ||
    (chlorine !== null && !inRange(chlorine, rcl.ideal))  ||
    (bromine  !== null && !inRange(bromine,  rbr.ideal))  ||
    (tac      !== null && !inRange(tac,      rtac.ideal))
  ) {
    return { status: 'cloudy', hasData: true }
  }

  return { status: 'clear', hasData: true }
}

/** Renders a DB-stored/matched raw string (action type, product name, quick tag) as a
 * translated label, without ever touching the raw value used for storage/matching. */
export function translateLabel(t: (key: TranslationKey) => string, map: Record<string, TranslationKey>, raw: string): string {
  return map[raw] ? t(map[raw]) : raw
}

export function getActionsThisMonth(actions: Action[], yearMonth: string): Action[] {
  return actions.filter(a => a.date.startsWith(yearMonth))
}

export function daysSinceLastAction(actions: Action[]): number {
  if (actions.length === 0) return 0
  const sorted = [...actions].sort((a, b) => b.date.localeCompare(a.date))
  const [year, month, day] = sorted[0].date.split('-').map(Number)
  const lastUtc = Date.UTC(year, month - 1, day)
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.floor((todayUtc - lastUtc) / (1000 * 60 * 60 * 24))
}

export function extractLastPh(actions: Action[]): string {
  const sorted = [...actions].sort((a, b) => b.date.localeCompare(a.date))
  for (const action of sorted) {
    const match = action.notes.match(/pH\s*([\d.]+)/)
    if (match) return match[1]
  }
  return '—'
}

// ── Extended measured params ───────────────────────────────────────────────

export type MeasuredParams = {
  ph: number | null
  chlorine: number | null
  tac: number | null
  temp: number | null
  bromine: number | null
  hardness: number | null
  salt: number | null
  stabilizer: number | null
  cc: number | null
  date: string | null
}

export type ParamStatus = 'normal' | 'warn' | 'bad'

export type PhPoint = { date: string; ph: number }

export type TodoItem = {
  id: string
  kind: 'measure' | 'maintenance' | 'chemistry'
  title: string
  subtitle: string
  delay: string
  isOverdue: boolean
}

/**
 * Extracts the most recent measured values for pH, chlorine, TAC and temperature
 * from the action log. Also returns the date of the most recent contributing entry.
 */
export function extractMeasuredParams(actions: Action[]): MeasuredParams {
  const sorted = [...actions].sort((a, b) => b.date.localeCompare(a.date))
  let ph: number | null = null
  let chlorine: number | null = null
  let tac: number | null = null
  let temp: number | null = null
  let bromine: number | null = null
  let hardness: number | null = null
  let salt: number | null = null
  let stabilizer: number | null = null
  let cc: number | null = null
  let date: string | null = null

  for (const action of sorted) {
    let contributed = false

    // pH: dedicated measurement stores value in qty
    if (ph === null && MEASURE_ACTION_TYPES.includes(action.action_type) && action.qty) {
      const v = parseFloat(action.qty)
      if (!isNaN(v)) { ph = v; contributed = true }
    }
    // pH fallback: parse from notes
    if (ph === null && action.notes) {
      const m = action.notes.match(/pH\s*([\d.]+)/i)
      if (m) { const v = parseFloat(m[1]); if (!isNaN(v)) { ph = v; contributed = true } }
    }
    // Free chlorine
    if (chlorine === null && action.notes) {
      const m = action.notes.match(RX_CHLORINE)
      if (m) { const v = parseFloat(m[1]); if (!isNaN(v)) { chlorine = v; contributed = true } }
    }
    // TAC
    if (tac === null && action.notes) {
      const m = action.notes.match(RX_TAC)
      if (m) { const v = parseFloat(m[1]); if (!isNaN(v)) { tac = v; contributed = true } }
    }
    // Temperature
    if (temp === null && action.notes) {
      const m = action.notes.match(RX_TEMP)
      if (m) { const v = parseFloat(m[1]); if (!isNaN(v)) { temp = v; contributed = true } }
    }
    // Total bromine
    if (bromine === null && action.notes) {
      const m = action.notes.match(RX_BROMINE)
      if (m) { const v = parseFloat(m[1]); if (!isNaN(v)) { bromine = v; contributed = true } }
    }
    // Total hardness
    if (hardness === null && action.notes) {
      const m = action.notes.match(RX_HARDNESS)
      if (m) { const v = parseFloat(m[1]); if (!isNaN(v)) { hardness = v; contributed = true } }
    }
    // Salt (ppm)
    if (salt === null && action.notes) {
      const m = action.notes.match(RX_SALT)
      if (m) { const v = parseFloat(m[1]); if (!isNaN(v)) { salt = v; contributed = true } }
    }
    // Stabilizer / cyanuric acid (CYA)
    if (stabilizer === null && action.notes) {
      const m = action.notes.match(RX_STABILIZER)
      if (m) { const v = parseFloat(m[1]); if (!isNaN(v)) { stabilizer = v; contributed = true } }
    }
    // Combined chlorine (CC) — deliberately does not contain "chlorine" as a substring,
    // so it never interacts with the free-chlorine regex above.
    if (cc === null && action.notes) {
      const m = action.notes.match(RX_CC)
      if (m) { const v = parseFloat(m[1]); if (!isNaN(v)) { cc = v; contributed = true } }
    }

    if (contributed && date === null) date = action.date

    if (
      ph !== null && chlorine !== null && tac !== null && temp !== null &&
      bromine !== null && hardness !== null && salt !== null && stabilizer !== null && cc !== null
    ) break
  }

  return { ph, chlorine, tac, temp, bromine, hardness, salt, stabilizer, cc, date }
}

function inRange(v: number, [min, max]: [number, number]): boolean {
  return v >= min && v <= max
}

/** pH: normal=7.0–7.6, warn=6.8–7.8, bad=outside */
export function getPhStatus(ph: number, ranges?: DynamicRanges): ParamStatus {
  const r = ranges?.ph ?? PARAM_RANGES.ph
  if (inRange(ph, r.ideal)) return 'normal'
  if (inRange(ph, r.acceptable)) return 'warn'
  return 'bad'
}

/** Chlorine: normal=0.5–3.0, warn=0.3–4.0, bad=outside */
export function getChlorineStatus(c: number, ranges?: DynamicRanges): ParamStatus {
  const r = ranges?.chlorine ?? PARAM_RANGES.chlorine
  if (inRange(c, r.ideal)) return 'normal'
  if (inRange(c, r.acceptable)) return 'warn'
  return 'bad'
}

/** TAC: normal=80–180, warn=60–200, bad=outside */
export function getTacStatus(tac: number, ranges?: DynamicRanges): ParamStatus {
  const r = ranges?.tac ?? PARAM_RANGES.tac
  if (inRange(tac, r.ideal)) return 'normal'
  if (inRange(tac, r.acceptable)) return 'warn'
  return 'bad'
}

/** Temp: normal=24–28, warn=15–35, bad=outside */
export function getTempStatus(temp: number, ranges?: DynamicRanges): ParamStatus {
  const r = ranges?.temp ?? PARAM_RANGES.temp
  if (inRange(temp, r.ideal)) return 'normal'
  if (inRange(temp, r.acceptable)) return 'warn'
  return 'bad'
}

/** Total bromine: normal=2–5 mg/L, warn=1–10 mg/L, bad=outside */
export function getBromineStatus(v: number, ranges?: DynamicRanges): ParamStatus {
  const r = ranges?.bromine ?? PARAM_RANGES.bromine
  if (inRange(v, r.ideal)) return 'normal'
  if (inRange(v, r.acceptable)) return 'warn'
  return 'bad'
}

/** Total hardness: normal=100–500 ppm, warn=50–1000 ppm, bad=outside */
export function getHardnessStatus(v: number, ranges?: DynamicRanges): ParamStatus {
  const r = ranges?.hardness ?? PARAM_RANGES.hardness
  if (inRange(v, r.ideal)) return 'normal'
  if (inRange(v, r.acceptable)) return 'warn'
  return 'bad'
}

/** Salt: normal=2700–3400 ppm, warn=2500–4500 ppm, bad=outside */
export function getSaltStatus(v: number, ranges?: DynamicRanges): ParamStatus {
  const r = ranges?.salt ?? PARAM_RANGES.salt
  if (inRange(v, r.ideal)) return 'normal'
  if (inRange(v, r.acceptable)) return 'warn'
  return 'bad'
}

/** Stabilizer (CYA): normal=60–80 ppm, warn=30–100 ppm, bad=outside */
export function getStabilizerStatus(v: number, ranges?: DynamicRanges): ParamStatus {
  const r = ranges?.stabilizer ?? PARAM_RANGES.stabilizer
  if (inRange(v, r.ideal)) return 'normal'
  if (inRange(v, r.acceptable)) return 'warn'
  return 'bad'
}

/** Combined chlorine (CC): normal=0–0.2 mg/L, warn=0–0.5 mg/L, bad=outside */
export function getCombinedChlorineStatus(v: number, ranges?: DynamicRanges): ParamStatus {
  const r = ranges?.cc ?? PARAM_RANGES.cc
  if (inRange(v, r.ideal)) return 'normal'
  if (inRange(v, r.acceptable)) return 'warn'
  return 'bad'
}

/** Returns last `limit` pH measurements, oldest first. */
export function getPhHistory(actions: Action[], limit = 10): PhPoint[] {
  const measurements = actions
    .filter(a => MEASURE_ACTION_TYPES.includes(a.action_type) && a.qty)
    .map(a => ({ date: a.date, ph: parseFloat(a.qty) }))
    .filter(p => !isNaN(p.ph))
    .sort((a, b) => a.date.localeCompare(b.date))
  return measurements.slice(-limit)
}

/** Returns actions from the previous calendar month. */
export function getActionsLastMonth(actions: Action[]): Action[] {
  const now = new Date()
  let year = now.getUTCFullYear()
  let month = now.getUTCMonth() // 0-indexed
  if (month === 0) { year -= 1; month = 12 } else { month -= 1 }
  const ym = `${year}-${String(month).padStart(2, '0')}`
  return actions.filter(a => a.date.startsWith(ym))
}

/** Days since a date string, calculated in UTC (same approach as daysSinceLastAction). */
export function getDaysSince(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  const dateUtc = Date.UTC(year, month - 1, day)
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.floor((todayUtc - dateUtc) / (1000 * 60 * 60 * 24))
}

/**
 * Treatment counts for a given year-month string (YYYY-MM).
 * maintenance = Cartridge cleaning / skimmer filter / pH calibration
 * additions   = Add product
 */
export function getTreatmentsThisMonth(
  actions: Action[],
  yearMonth: string,
): { total: number; maintenance: number; additions: number } {
  const MAINTENANCE_TYPES = ['Cartridge cleaning', 'Skimmer filter cleaning', 'pH calibration']
  const monthActions = actions.filter(a => a.date.startsWith(yearMonth))
  const maintenance = monthActions.filter(a => MAINTENANCE_TYPES.includes(a.action_type)).length
  const additions = monthActions.filter(a => a.action_type === 'Add product').length
  return { total: monthActions.length, maintenance, additions }
}

// Show a maintenance task on the dashboard's attention panel when it is
// never-done, overdue, or coming due within this many days.
const MAINTENANCE_WARN_WITHIN_DAYS = 5

/** Localized display name for a maintenance task: built-in tasks resolve via
 * `maint_task_<builtin_key>`, everything else uses the stored label. */
export function maintenanceTaskLabel(
  task: { builtin_key: string | null; label: string },
  t: (key: TranslationKey) => string,
): string {
  if (task.builtin_key) {
    const key = `maint_task_${task.builtin_key}` as TranslationKey
    const translated = t(key)
    // t() returns the raw key when a translation is missing — fall back to the
    // stored label rather than surfacing the key.
    if (translated && translated !== key) return translated
  }
  return task.label
}

/**
 * Maps configured maintenance tasks (with derived due status from the API) to
 * dashboard attention-panel items, keeping only enabled tasks that are
 * never-done, overdue, or due within the warn window.
 */
export function maintenanceTodoItems(
  tasks: MaintenanceTask[],
  t: (key: TranslationKey) => string,
): TodoItem[] {
  const items: TodoItem[] = []
  for (const task of tasks) {
    if (!task.enabled) continue
    const days = task.days_until_due
    if (days !== null && days > MAINTENANCE_WARN_WITHIN_DAYS) continue
    const neverDone = days === null
    const overdue = days !== null && days < 0
    items.push({
      id: `maint-${task.key}`,
      kind: task.builtin_key === 'ph_measurement' ? 'measure' : 'maintenance',
      title: maintenanceTaskLabel(task, t),
      subtitle: `${t('maint_every')} ${task.interval_days} ${t('todo_day_abbr')}`,
      delay: neverDone
        ? t('todo_never_done')
        : overdue
          ? `${t('kpi_overdue')} (${Math.abs(days as number)} ${t('todo_day_abbr')})`
          : `${t('kpi_in')} ${days} ${t('todo_day_abbr')}`,
      isOverdue: overdue || neverDone,
    })
  }
  return items
}

/**
 * Chemistry-based to-do items derived from the latest measured params (e.g. low
 * chlorine). Scheduled maintenance now comes from maintenanceTodoItems, which is
 * driven by the configurable tasks stored server-side.
 */
export function getChemistryTodoItems(params: MeasuredParams, t: (key: TranslationKey) => string): TodoItem[] {
  const items: TodoItem[] = []

  if (params.chlorine !== null && params.chlorine < 1) {
    items.push({
      id: 'chlorine-low',
      kind: 'chemistry',
      title: t('todo_low_chlorine_title'),
      subtitle: `${t('param_chlorine')} : ${params.chlorine} mg/L (${t('todo_chlorine_min_recommended')})`,
      delay: t('todo_check'),
      isOverdue: false,
    })
  }

  return items
}

// ── Param history (sparklines / trend charts) ───────────────────────────────

export type ParamPoint = { date: string; value: number }

export type HistoryParamKey =
  | 'ph' | 'chlorine' | 'tac' | 'temp' | 'bromine' | 'hardness' | 'salt' | 'stabilizer' | 'cc'

const HISTORY_RX: Record<Exclude<HistoryParamKey, 'ph'>, RegExp> = {
  chlorine: RX_CHLORINE,
  tac: RX_TAC,
  temp: RX_TEMP,
  bromine: RX_BROMINE,
  hardness: RX_HARDNESS,
  salt: RX_SALT,
  stabilizer: RX_STABILIZER,
  cc: RX_CC,
}

/**
 * Last `limit` measured values of a parameter, oldest-first.
 * pH reads the dedicated qty field (with a notes fallback); everything else
 * parses the structured `key: value` fields toPayload writes into notes.
 */
export function getParamHistory(actions: Action[], param: HistoryParamKey, limit = 10): ParamPoint[] {
  const result: ParamPoint[] = []
  for (const a of [...actions].sort((x, y) => x.date.localeCompare(y.date))) {
    if (!MEASURE_ACTION_TYPES.includes(a.action_type)) continue
    let v: number | null = null
    if (param === 'ph') {
      if (a.qty) v = parseFloat(a.qty)
      if (v === null || isNaN(v)) {
        const m = a.notes?.match(/pH\s*([\d.]+)/i)
        if (m) v = parseFloat(m[1])
      }
    } else {
      const m = a.notes?.match(HISTORY_RX[param])
      if (m) v = parseFloat(m[1])
    }
    if (v !== null && !isNaN(v)) result.push({ date: a.date, value: v })
  }
  return result.slice(-limit)
}

// ── Measurements page helpers ───────────────────────────────────────────────

export type ChlorinePoint = { date: string; chlorine: number }

/**
 * Filter measure-type actions by rolling period.
 * months=1 → from the 1st of the current month.
 * months=3/6 → from the 1st of (currentMonth - months + 1).
 * months=null → all.
 * Returns sorted newest-first.
 */
export function getFilteredMeasureActions(actions: Action[], months: number | null): Action[] {
  const filtered = actions.filter(a => MEASURE_ACTION_TYPES.includes(a.action_type))
  if (months === null) return filtered.sort((a, b) => b.date.localeCompare(a.date))
  const now = new Date()
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1))
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return filtered
    .filter(a => a.date >= cutoffStr)
    .sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * pH trend for a given year-month: first vs last value.
 * trend='up' means improving toward 7.2, 'down' worsening, 'stable' if diff < 0.1.
 */
export function getPhTrend(
  actions: Action[],
  yearMonth: string,
): { first: number; last: number; trend: 'up' | 'down' | 'stable' } | null {
  const pts = actions
    .filter(a => MEASURE_ACTION_TYPES.includes(a.action_type) && a.date.startsWith(yearMonth) && a.qty)
    .map(a => ({ date: a.date, ph: parseFloat(a.qty) }))
    .filter(p => !isNaN(p.ph))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (pts.length < 2) return null
  const first = pts[0].ph
  const last = pts[pts.length - 1].ph
  if (Math.abs(last - first) < 0.1) return { first, last, trend: 'stable' }
  const IDEAL = 7.2
  const improving = Math.abs(last - IDEAL) < Math.abs(first - IDEAL)
  return { first, last, trend: improving ? 'up' : 'down' }
}

/**
 * Last `limit` free chlorine values from the given actions, oldest-first.
 * Caller should pre-filter by period before passing.
 */
export function getChlorineHistory(actions: Action[], limit = 7): ChlorinePoint[] {
  const result: ChlorinePoint[] = []
  for (const a of [...actions].sort((x, y) => x.date.localeCompare(y.date))) {
    if (!MEASURE_ACTION_TYPES.includes(a.action_type)) continue
    const m = a.notes.match(RX_CHLORINE)
    if (m) {
      const v = parseFloat(m[1])
      if (!isNaN(v)) result.push({ date: a.date, chlorine: v })
    }
  }
  return result.slice(-limit)
}
