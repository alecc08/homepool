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
  created_at: string
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
