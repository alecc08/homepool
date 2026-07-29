import { createElement } from 'react'
import {
  ArrowDownToLine,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Beaker,
  Brush,
  CalendarClock,
  CircleDashed,
  Droplet,
  Droplets,
  FlaskConical,
  Magnet,
  Sparkles,
  SlidersHorizontal,
  SprayCan,
  Sun,
  Thermometer,
  TriangleAlert,
  Waves,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// A maintenance task or treatment product stores its icon as an mdi name,
// because that is what Home Assistant renders. The web app draws lucide icons,
// so every icon either can have needs an entry here. Tasks the API seeds use
// the first six; the rest are offered in the pickers so a task or product added
// later has a real icon too, instead of falling back to the wrench.
export const MDI_TO_LUCIDE: Record<string, LucideIcon> = {
  'mdi:test-tube': FlaskConical,
  'mdi:air-filter': Wrench,
  'mdi:water-sync': Droplets,
  'mdi:tune-vertical': SlidersHorizontal,
  'mdi:pipe-valve': Waves,
  'mdi:beaker-plus': Beaker,
  'mdi:calendar-clock': CalendarClock,
  'mdi:broom': Brush,
  'mdi:auto-fix': Sparkles,
  'mdi:thermometer': Thermometer,
  'mdi:weather-sunny': Sun,
  // Seeded treatment products (see DEFAULT_TREATMENT_PRODUCTS in the API).
  'mdi:arrow-up-bold': ArrowUpWideNarrow,
  'mdi:arrow-down-bold': ArrowDownWideNarrow,
  'mdi:waves-arrow-up': Waves,
  'mdi:water-plus': Droplet,
  'mdi:water-check': Droplet,
  'mdi:flash': Zap,
  'mdi:flash-triangle': TriangleAlert,
  'mdi:spray-bottle': SprayCan,
  'mdi:water-opacity': CircleDashed,
  'mdi:magnet': Magnet,
  'mdi:arrow-collapse-down': ArrowDownToLine,
  'mdi:chart-bubble': CircleDashed,
  'mdi:shaker-outline': Beaker,
  'mdi:flask': FlaskConical,
}

export const DEFAULT_TASK_ICON = 'mdi:calendar-clock'
export const DEFAULT_TREATMENT_ICON = 'mdi:beaker-plus'

/** The icons offered in the task config picker, in display order. */
export const TASK_ICON_CHOICES: string[] = Object.keys(MDI_TO_LUCIDE)

/** The icons offered in the treatment config picker. The chemistry-flavoured
 * ones lead; the scheduling ones a task would want are dropped. */
export const TREATMENT_ICON_CHOICES: string[] = [
  'mdi:beaker-plus',
  'mdi:arrow-up-bold',
  'mdi:arrow-down-bold',
  'mdi:waves-arrow-up',
  'mdi:water-plus',
  'mdi:water-check',
  'mdi:flash',
  'mdi:flash-triangle',
  'mdi:spray-bottle',
  'mdi:water-opacity',
  'mdi:magnet',
  'mdi:arrow-collapse-down',
  'mdi:chart-bubble',
  'mdi:shaker-outline',
  'mdi:flask',
  'mdi:air-filter',
  'mdi:weather-sunny',
]

/** Renders a task's icon from its stored mdi name; a wrench for anything
 * unrecognized (a task whose icon was set through the API, say).
 *
 * Built with createElement rather than a `const Icon = lookup(...)` local, which
 * the React compiler lint flags as creating a component during render. */
export function TaskIcon({
  name, size = 16,
}: { name: string | null | undefined; size?: number }) {
  const icon: LucideIcon = (name && MDI_TO_LUCIDE[name]) || Wrench
  return createElement(icon, { size, strokeWidth: 1.75, 'aria-hidden': true })
}
