export type TempUnit = 'C' | 'F'
export type SaltUnit = 'ppm' | 'g/L'
export type ConcUnit = 'mg/L' | 'ppm'
export type HardnessUnit = 'ppm' | '°dH' | '°f'

export const celsiusToFahrenheit = (c: number) => c * 9 / 5 + 32
export const fahrenheitToCelsius = (f: number) => (f - 32) * 5 / 9
export const ppmToGramsPerLiter = (ppm: number) => ppm / 1000
export const gramsPerLiterToPpm = (gpl: number) => gpl * 1000
export const ppmToGermanDegrees = (ppm: number) => ppm / 17.848
export const germanDegreesToPpm = (dh: number) => dh * 17.848
export const ppmToFrenchDegrees = (ppm: number) => ppm / 10
export const frenchDegreesToPpm = (of: number) => of * 10

type Range = { ideal: [number, number]; acceptable: [number, number] }

/** Applies a converter across an {ideal, acceptable} range pair (identity if unit === canonical). */
export function convertRange(range: Range, convert: (n: number) => number): Range {
  return {
    ideal: [convert(range.ideal[0]), convert(range.ideal[1])],
    acceptable: [convert(range.acceptable[0]), convert(range.acceptable[1])],
  }
}

/** Rounds for display purposes (avoid "75.19999999999999°F"). */
export function formatUnitRange([min, max]: [number, number], decimals = 1): string {
  const round = (n: number) => {
    const factor = 10 ** decimals
    return Math.round(n * factor) / factor
  }
  return `${round(min)} – ${round(max)}`
}
