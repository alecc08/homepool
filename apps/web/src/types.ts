import type { TempUnit, SaltUnit, ConcUnit, HardnessUnit } from './units'

export type Product = {
  id: number
  name: string
  type: string
  unit_default: string
}

export type User = {
  id: number
  email: string
  first_name: string
  created_at: string
}

export type Action = {
  id: number
  date: string
  action_type: string
  user_id: number | null
  installation_id?: number | null
  product_id: number | null
  qty: string
  unit: string
  notes: string
  created_at: string
}

export type Installation = {
  id: number
  user_id: number
  name: string
  type: 'pool' | 'spa'
  sanitizer: 'bromine' | 'chlorine' | 'salt'
  volume?: number | null
  volume_unit?: 'L' | 'gal'
  temp_unit?: TempUnit
  salt_unit?: SaltUnit
  conc_unit?: ConcUnit
  hardness_unit?: HardnessUnit
  address?: string | null
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  notes?: string | null
  created_at: string
}

/** A configurable maintenance task with its derived due status, as returned by
 * GET /installations/{id}/maintenance. `key` is stable across renames
 * (builtin_key or custom_<id>); built-in tasks localize via builtin_key and
 * fall back to `label`. days_until_due / last_date are null when never logged. */
export type MaintenanceTask = {
  id: number
  key: string
  builtin_key: string | null
  label: string
  icon: string
  action_types: string[]
  interval_days: number
  enabled: boolean
  sort_order: number
  days_until_due: number | null
  last_date: string | null
}

export type InstallationWaterParams = {
  ph: { ideal: [number, number]; acceptable: [number, number] }
  tac: { ideal: [number, number]; acceptable: [number, number] }
  temp: { ideal: [number, number]; acceptable: [number, number] }
  cl?: { ideal: [number, number]; acceptable: [number, number] }
  br?: { ideal: [number, number]; acceptable: [number, number] }
  salt?: { ideal: [number, number]; acceptable: [number, number] }
  cya?: { ideal: [number, number]; acceptable: [number, number] }
  cc?: { ideal: [number, number]; acceptable: [number, number] }
  hardness?: { ideal: [number, number]; acceptable: [number, number] }
}

/** Backend param keys used by /params and /params/full (canonical, not display labels). */
export type ParamKey = 'ph' | 'cl' | 'br' | 'cc' | 'tac' | 'temp' | 'salt' | 'cya' | 'hardness'

export type ParamBand = { ideal: [number, number]; acceptable: [number, number] }

/** One entry of the GET /installations/{id}/params/full response. */
export type ParamFullEntry = {
  default: ParamBand
  override: { ideal?: [number, number]; acceptable?: [number, number] } | null
  effective: ParamBand
}

export type InstallationParamsFull = Partial<Record<ParamKey, ParamFullEntry>>

/** One dosing option within a Recommendation, as returned by
 * GET /installations/{id}/recommendations (apps/api/dosage.py). `amount_grams`/
 * `amount_ml` are null for non-exact products or when the installation's volume
 * isn't set — never invented client-side. */
export type DosageOption = {
  product_id: string | null
  form: 'solid' | 'liquid' | null
  exact: boolean
  amount_grams: number | null
  amount_ml: number | null
  notes_key: string | null
}

export type Recommendation = {
  param: ParamKey
  current_value: number
  target_value: number
  direction: 'raise' | 'lower'
  volume_known: boolean
  options: DosageOption[]
}

export type RecommendationsResponse = {
  volume_known: boolean
  recommendations: Recommendation[]
}
