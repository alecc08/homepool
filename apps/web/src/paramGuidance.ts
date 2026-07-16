import type { ParamKey } from './types'
import type { TranslationKey } from './i18n/translations'

export type ParamGuidance = {
  key: ParamKey
  labelKey: TranslationKey
  whyKey: TranslationKey
  sourceKey?: TranslationKey
  extraKey?: TranslationKey
  /** Sane absolute bounds, canonical/metric units. Mirrors PARAM_BOUNDS in apps/api/main.py —
   * kept in sync manually, since bounds change far less often than the ranges themselves. */
  bounds: [number, number]
  /** Salt gets a non-dismissable-by-default callout since its ideal band depends on the
   * specific chlorinator/SWG model installed — more prominent than the plain tooltip other
   * params get. */
  prominent?: boolean
}

/** One entry per water-chemistry param, in display order. Only params relevant to a given
 * installation's (type, sanitizer) combo are ever rendered — driven by /params/full's keys. */
export const PARAM_GUIDANCE: Record<ParamKey, ParamGuidance> = {
  ph: {
    key: 'ph',
    labelKey: 'param_ph',
    whyKey: 'guidance_ph_why',
    bounds: [0, 14],
  },
  cl: {
    key: 'cl',
    labelKey: 'guidance_cl_label',
    whyKey: 'guidance_cl_why',
    bounds: [0, 20],
  },
  br: {
    key: 'br',
    labelKey: 'param_bromine',
    whyKey: 'guidance_br_why',
    bounds: [0, 20],
  },
  cc: {
    key: 'cc',
    labelKey: 'guidance_cc_label',
    whyKey: 'guidance_cc_why',
    bounds: [0, 10],
  },
  tac: {
    key: 'tac',
    labelKey: 'param_tac',
    whyKey: 'guidance_tac_why',
    bounds: [0, 500],
  },
  temp: {
    key: 'temp',
    labelKey: 'param_temp_label',
    whyKey: 'guidance_temp_why',
    bounds: [0, 50],
  },
  salt: {
    key: 'salt',
    labelKey: 'param_salt',
    whyKey: 'guidance_salt_why',
    sourceKey: 'guidance_salt_source',
    extraKey: 'guidance_salt_extra',
    bounds: [0, 10000],
    prominent: true,
  },
  cya: {
    key: 'cya',
    labelKey: 'guidance_cya_label',
    whyKey: 'guidance_cya_why',
    sourceKey: 'guidance_cya_source',
    bounds: [0, 300],
  },
  hardness: {
    key: 'hardness',
    labelKey: 'unit_hardness',
    whyKey: 'guidance_hardness_why',
    bounds: [0, 2000],
  },
}

export const PARAM_ORDER: ParamKey[] = ['ph', 'cl', 'br', 'cc', 'tac', 'temp', 'salt', 'cya', 'hardness']
