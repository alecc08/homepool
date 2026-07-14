import { describe, it, expect } from 'vitest'
import type { Action, Installation, InstallationWaterParams } from './types'
import { ppmToGermanDegrees } from './units'
import {
  getActionsThisMonth,
  daysSinceLastAction,
  extractLastPh,
  getSaltStatus,
  getStabilizerStatus,
  getCombinedChlorineStatus,
  getHardnessStatus,
  getWaterStatus,
  extractMeasuredParams,
  installationParamsToRanges,
  getTodoItems,
  type MeasuredParams,
  type WaterParams,
  type DynamicRanges,
} from './utils'
import { translations } from './i18n/translations'

const t = (key: string) => (translations.fr as Record<string, string>)[key] ?? key

function daysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

const makeInstallation = (overrides: Partial<Installation> = {}): Installation => ({
  id: 1,
  user_id: 1,
  name: 'My pool',
  type: 'pool',
  sanitizer: 'chlorine',
  created_at: '2026-01-01T00:00:00',
  ...overrides,
})

const makeAction = (overrides: Partial<Action> = {}): Action => ({
  id: 1,
  date: '2026-02-24',
  action_type: 'Test',
  user_id: 1,
  product_id: null,
  qty: '',
  unit: '',
  notes: '',
  created_at: '2026-02-24T00:00:00',
  ...overrides,
})

describe('getActionsThisMonth', () => {
  it('returns actions matching the given year-month', () => {
    const actions = [
      makeAction({ id: 1, date: '2026-02-10' }),
      makeAction({ id: 2, date: '2026-01-15' }),
    ]
    expect(getActionsThisMonth(actions, '2026-02')).toHaveLength(1)
  })

  it('returns empty for no match', () => {
    const actions = [makeAction({ date: '2026-01-15' })]
    expect(getActionsThisMonth(actions, '2026-02')).toHaveLength(0)
  })
})

describe('daysSinceLastAction', () => {
  it('returns 0 for empty list', () => {
    expect(daysSinceLastAction([])).toBe(0)
  })
})

describe('extractLastPh', () => {
  it('returns — for empty list', () => {
    expect(extractLastPh([])).toBe('—')
  })

  it('returns — when no pH in notes', () => {
    const actions = [makeAction({ notes: 'eau claire' })]
    expect(extractLastPh(actions)).toBe('—')
  })

  it('extracts pH value from notes field', () => {
    const actions = [makeAction({ notes: 'pH 7.4, tout ok' })]
    expect(extractLastPh(actions)).toBe('7.4')
  })

  it('returns most recent pH when multiple actions', () => {
    const actions = [
      makeAction({ id: 1, date: '2026-02-24', notes: 'pH 7.4' }),
      makeAction({ id: 2, date: '2026-02-20', notes: 'pH 7.1' }),
    ]
    expect(extractLastPh(actions)).toBe('7.4')
  })
})

describe('getSaltStatus', () => {
  it('normal within 2700-3400', () => {
    expect(getSaltStatus(3000)).toBe('normal')
    expect(getSaltStatus(2700)).toBe('normal')
    expect(getSaltStatus(3400)).toBe('normal')
  })
  it('warn within acceptable band 2500-4500', () => {
    expect(getSaltStatus(2600)).toBe('warn')
    expect(getSaltStatus(4000)).toBe('warn')
  })
  it('bad outside acceptable band', () => {
    expect(getSaltStatus(2000)).toBe('bad')
    expect(getSaltStatus(5000)).toBe('bad')
  })
  it('respects custom ranges', () => {
    const ranges = { salt: { ideal: [1000, 2000] as [number, number], acceptable: [500, 3000] as [number, number] } }
    expect(getSaltStatus(1500, ranges)).toBe('normal')
    expect(getSaltStatus(2500, ranges)).toBe('warn')
    expect(getSaltStatus(4000, ranges)).toBe('bad')
  })
})

describe('getStabilizerStatus', () => {
  it('normal within 60-80', () => {
    expect(getStabilizerStatus(70)).toBe('normal')
  })
  it('warn within acceptable band 30-100', () => {
    expect(getStabilizerStatus(40)).toBe('warn')
    expect(getStabilizerStatus(90)).toBe('warn')
  })
  it('bad outside acceptable band', () => {
    expect(getStabilizerStatus(10)).toBe('bad')
    expect(getStabilizerStatus(150)).toBe('bad')
  })
})

describe('getCombinedChlorineStatus', () => {
  it('normal within 0-0.2', () => {
    expect(getCombinedChlorineStatus(0)).toBe('normal')
    expect(getCombinedChlorineStatus(0.2)).toBe('normal')
  })
  it('warn within acceptable band 0-0.5', () => {
    expect(getCombinedChlorineStatus(0.4)).toBe('warn')
  })
  it('bad outside acceptable band', () => {
    expect(getCombinedChlorineStatus(0.8)).toBe('bad')
  })
})

describe('extractMeasuredParams — salt/stabilizer/cc', () => {
  it('parses salt, stabilizer, combined from notes', () => {
    const actions = [makeAction({ action_type: 'Measurement', notes: 'salt: 3200. stabilizer: 65. combined: 0.3' })]
    const p = extractMeasuredParams(actions)
    expect(p.salt).toBe(3200)
    expect(p.stabilizer).toBe(65)
    expect(p.cc).toBe(0.3)
  })

  it('is case-insensitive', () => {
    const actions = [makeAction({ action_type: 'Measurement', notes: 'SALT: 2900. STABILIZER: 55. COMBINED: 0.1' })]
    const p = extractMeasuredParams(actions)
    expect(p.salt).toBe(2900)
    expect(p.stabilizer).toBe(55)
    expect(p.cc).toBe(0.1)
  })

  it('does not false-positive on unrelated text mentioning "salt" with no following number', () => {
    const actions = [makeAction({ action_type: 'Measurement', notes: 'Added salt to the pool' })]
    const p = extractMeasuredParams(actions)
    expect(p.salt).toBeNull()
  })

  it('parses chlorine and combined independently without collision', () => {
    const actions = [makeAction({ action_type: 'Measurement', notes: 'chlorine: 1.5. combined: 0.3' })]
    const p = extractMeasuredParams(actions)
    expect(p.chlorine).toBe(1.5)
    expect(p.cc).toBe(0.3)
  })
})

describe('extractMeasuredParams — regex data-loss regression (bug: greedy trailing-period capture + temperature hijack)', () => {
  it('extracts the real temperature value, not a hijacked value from an earlier "...t: N" pattern', () => {
    // stabilizer contains a "t" immediately before ": 65." — a permissive temperature
    // regex can match there before ever reaching the real "temperature: 82" further along.
    const notes = 'chlorine: 1.5. TAC: 120. hardness: 250. salt: 3200. stabilizer: 65. combined: 0.1. temperature: 82. Clear water. Level OK'
    const actions = [makeAction({ action_type: 'Measurement', notes })]
    const p = extractMeasuredParams(actions)
    expect(p.temp).toBe(82)
    expect(p.stabilizer).toBe(65)
  })

  it('extracts exact values (no swallowed trailing period) for every field in a fully-filled notes string', () => {
    const notes = 'chlorine: 1.5. TAC: 120. hardness: 250. salt: 3200. stabilizer: 65. combined: 0.1. temperature: 82. Clear water. Level OK'
    const actions = [makeAction({ action_type: 'Measurement', notes })]
    const p = extractMeasuredParams(actions)
    expect(p.chlorine).toBe(1.5)
    expect(p.tac).toBe(120)
    expect(p.hardness).toBe(250)
    expect(p.salt).toBe(3200)
    expect(p.cc).toBe(0.1)
  })
})

describe('installationParamsToRanges — salt/cya/cc', () => {
  it('maps salt→sel, cya→stabilisant, cc→cc', () => {
    const params: InstallationWaterParams = {
      ph: { ideal: [7.2, 7.6], acceptable: [6.8, 7.8] },
      tac: { ideal: [80, 180], acceptable: [60, 200] },
      temp: { ideal: [24, 28], acceptable: [15, 35] },
      salt: { ideal: [2700, 3400], acceptable: [2500, 4500] },
      cya: { ideal: [60, 80], acceptable: [30, 100] },
      cc: { ideal: [0, 0.2], acceptable: [0, 0.5] },
    }
    const ranges = installationParamsToRanges(params)
    expect(ranges.salt).toEqual({ ideal: [2700, 3400], acceptable: [2500, 4500] })
    expect(ranges.stabilizer).toEqual({ ideal: [60, 80], acceptable: [30, 100] })
    expect(ranges.cc).toEqual({ ideal: [0, 0.2], acceptable: [0, 0.5] })
  })
})

describe('getHardnessStatus', () => {
  it('normal within 100-500 ppm (default ranges)', () => {
    expect(getHardnessStatus(250)).toBe('normal')
  })
  it('bad outside acceptable band (default ranges)', () => {
    expect(getHardnessStatus(2000)).toBe('bad')
  })
  it('respects a custom hardness range override', () => {
    const ranges = { hardness: { ideal: [10, 20] as [number, number], acceptable: [5, 30] as [number, number] } }
    expect(getHardnessStatus(15, ranges)).toBe('normal')
    expect(getHardnessStatus(25, ranges)).toBe('warn')
    expect(getHardnessStatus(40, ranges)).toBe('bad')
  })
})

describe('getWaterStatus', () => {
  const inRangeParams: WaterParams = { ph: 7.2, chlorine: 1.5, tac: 100, bromine: null }

  it('returns clear when all measured params are within their ideal range', () => {
    expect(getWaterStatus(inRangeParams)).toEqual({ status: 'clear', hasData: true })
  })

  it('returns clear with hasData false when no param has been measured', () => {
    expect(getWaterStatus({ ph: null, chlorine: null, tac: null, bromine: null })).toEqual({ status: 'clear', hasData: false })
  })

  it('returns green when ph alone is outside its acceptable range', () => {
    expect(getWaterStatus({ ...inRangeParams, ph: 5.0 })).toEqual({ status: 'green', hasData: true })
  })

  it('returns green when chlore alone is outside its acceptable range', () => {
    expect(getWaterStatus({ ...inRangeParams, chlorine: 10 })).toEqual({ status: 'green', hasData: true })
  })

  it('returns green when brome alone is outside its acceptable range', () => {
    expect(getWaterStatus({ ...inRangeParams, bromine: 20 })).toEqual({ status: 'green', hasData: true })
  })

  it('regression: TAC outside acceptable range alone falls to cloudy, not green', () => {
    expect(getWaterStatus({ ph: null, chlorine: null, tac: 250, bromine: null })).toEqual({ status: 'cloudy', hasData: true })
    expect(getWaterStatus({ ...inRangeParams, tac: 250 })).toEqual({ status: 'cloudy', hasData: true })
  })

  it('returns cloudy when TAC is outside ideal but within acceptable, others ideal', () => {
    expect(getWaterStatus({ ...inRangeParams, tac: 70 })).toEqual({ status: 'cloudy', hasData: true })
  })

  it('respects a ranges override for a TAC-alone excursion', () => {
    const ranges: DynamicRanges = { tac: { ideal: [10, 20], acceptable: [5, 30] } }
    expect(getWaterStatus({ ph: null, chlorine: null, tac: 40, bromine: null }, ranges)).toEqual({ status: 'cloudy', hasData: true })
  })
})

describe('installationParamsToRanges — unit-aware temp/sel/durete', () => {
  const params: InstallationWaterParams = {
    ph: { ideal: [7.2, 7.6], acceptable: [6.8, 7.8] },
    tac: { ideal: [80, 180], acceptable: [60, 200] },
    temp: { ideal: [24, 28], acceptable: [15, 35] },
    salt: { ideal: [2700, 3400], acceptable: [2500, 4500] },
  }

  it('converts temp range to Fahrenheit when installation.temp_unit is F', () => {
    const ranges = installationParamsToRanges(params, makeInstallation({ temp_unit: 'F' }))
    expect(ranges.temp!.ideal[0]).toBeCloseTo(75.2, 5)
    expect(ranges.temp!.ideal[1]).toBeCloseTo(82.4, 5)
  })

  it('converts sel range to g/L when installation.salt_unit is g/L', () => {
    const ranges = installationParamsToRanges(params, makeInstallation({ salt_unit: 'g/L' }))
    expect(ranges.salt!.ideal).toEqual([2.7, 3.4])
  })

  it('leaves temp/sel unchanged for an installation without unit overrides, or no installation at all', () => {
    const withDefaultInstallation = installationParamsToRanges(params, makeInstallation())
    expect(withDefaultInstallation.temp).toEqual(params.temp)
    expect(withDefaultInstallation.salt).toEqual(params.salt)

    const withoutInstallation = installationParamsToRanges(params)
    expect(withoutInstallation.temp).toEqual(params.temp)
    expect(withoutInstallation.salt).toEqual(params.salt)
  })

  it('synthesizes a durete range client-side, converted per durete_unit, even though the backend never returns durete', () => {
    const ppmRanges = installationParamsToRanges(params, makeInstallation())
    expect(ppmRanges.hardness).toEqual({ ideal: [100, 500], acceptable: [50, 1000] })

    const dhRanges = installationParamsToRanges(params, makeInstallation({ durete_unit: '°dH' }))
    expect(dhRanges.hardness!.ideal[0]).toBeCloseTo(ppmToGermanDegrees(100), 5)
    expect(dhRanges.hardness!.ideal[1]).toBeCloseTo(ppmToGermanDegrees(500), 5)

    const fRanges = installationParamsToRanges(params, makeInstallation({ durete_unit: '°f' }))
    expect(fRanges.hardness!.ideal).toEqual([10, 50])
  })

  it('prefers a backend-provided durete range over PARAM_RANGES when present, with unit conversion still applied on top', () => {
    const withDurete: InstallationWaterParams = { ...params, durete: { ideal: [10, 20], acceptable: [5, 30] } }

    const ppmRanges = installationParamsToRanges(withDurete, makeInstallation())
    expect(ppmRanges.hardness).toEqual({ ideal: [10, 20], acceptable: [5, 30] })

    const dhRanges = installationParamsToRanges(withDurete, makeInstallation({ durete_unit: '°dH' }))
    expect(dhRanges.hardness!.ideal[0]).toBeCloseTo(ppmToGermanDegrees(10), 5)
    expect(dhRanges.hardness!.ideal[1]).toBeCloseTo(ppmToGermanDegrees(20), 5)
  })
})

describe('getTodoItems', () => {
  const emptyParams: MeasuredParams = {
    ph: null, chlorine: null, tac: null, temp: null, bromine: null,
    hardness: null, salt: null, stabilizer: null, cc: null, date: null,
  }

  it('flags pH as never measured when there is no measurement history', () => {
    const items = getTodoItems([], emptyParams, t)
    const ph = items.find(i => i.id === 'ph-measure')
    expect(ph).toBeDefined()
    expect(ph!.delay).toBe('Jamais mesuré')
    expect(ph!.isOverdue).toBe(true)
  })

  it('flags pH as overdue past the 7-day cycle', () => {
    const actions = [makeAction({ action_type: 'Measurement', qty: '7.2', date: daysAgo(10) })]
    const items = getTodoItems(actions, emptyParams, t)
    const ph = items.find(i => i.id === 'ph-measure')
    expect(ph!.delay).toBe('En retard (3 j)')
    expect(ph!.isOverdue).toBe(true)
  })

  it('shows an upcoming pH measurement within the 5-day warn window', () => {
    const actions = [makeAction({ action_type: 'Measurement', qty: '7.2', date: daysAgo(3) })]
    const items = getTodoItems(actions, emptyParams, t)
    const ph = items.find(i => i.id === 'ph-measure')
    expect(ph!.delay).toBe('Dans 4 j')
    expect(ph!.isOverdue).toBe(false)
  })

  it('does not flag pH when well within the cycle (more than 5 days left)', () => {
    const actions = [makeAction({ action_type: 'Measurement', qty: '7.2', date: daysAgo(1) })]
    const items = getTodoItems(actions, emptyParams, t)
    expect(items.find(i => i.id === 'ph-measure')).toBeUndefined()
  })

  it('flags filter maintenance as never done with no history', () => {
    const items = getTodoItems([], emptyParams, t)
    const filter = items.find(i => i.id === 'filter-maintenance')
    expect(filter!.delay).toBe('Jamais fait')
  })

  it('flags filter maintenance as overdue past 14 days', () => {
    const actions = [makeAction({ action_type: 'Cartridge cleaning', date: daysAgo(20) })]
    const items = getTodoItems(actions, emptyParams, t)
    const filter = items.find(i => i.id === 'filter-maintenance')
    expect(filter!.delay).toBe('En retard (20 j)')
  })

  it('does not flag filter maintenance when recently done', () => {
    const actions = [makeAction({ action_type: 'Cartridge cleaning', date: daysAgo(2) })]
    const items = getTodoItems(actions, emptyParams, t)
    expect(items.find(i => i.id === 'filter-maintenance')).toBeUndefined()
  })

  it('flags low chlore', () => {
    const items = getTodoItems([], { ...emptyParams, chlorine: 0.5 }, t)
    const chlore = items.find(i => i.id === 'chlorine-low')
    expect(chlore!.title).toBe('Chlore faible')
    expect(chlore!.subtitle).toBe('Chlore libre : 0.5 mg/L (min. recommandé : 1 mg/L)')
    expect(chlore!.delay).toBe('Vérifier')
  })

  it('does not flag chlore when at or above the minimum', () => {
    const items = getTodoItems([], { ...emptyParams, chlorine: 1.2 }, t)
    expect(items.find(i => i.id === 'chlorine-low')).toBeUndefined()
  })
})
