import { createElement } from 'react'
import {
  Beaker,
  Brush,
  CalendarClock,
  Droplets,
  FlaskConical,
  Sparkles,
  SlidersHorizontal,
  Sun,
  Thermometer,
  Waves,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// A maintenance task stores its icon as an mdi name, because that is what Home
// Assistant renders. The web app draws lucide icons, so every icon a task can
// have needs an entry here. Tasks the API seeds use the first six; the rest are
// offered in the picker so a task added later has a real icon too, instead of
// falling back to the wrench.
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
}

export const DEFAULT_TASK_ICON = 'mdi:calendar-clock'

/** The icons offered in the task config picker, in display order. */
export const TASK_ICON_CHOICES: string[] = Object.keys(MDI_TO_LUCIDE)

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
