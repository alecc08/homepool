import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MaintenancePage from './MaintenancePage'
import { translations } from '../i18n/translations'
import type { MaintenanceTask } from '../types'

vi.mock('../context/LocaleContext', () => ({
  useT: () => ({
    locale: 'fr',
    setLocale: vi.fn(),
    t: (key: string) => (translations.fr as Record<string, string>)[key] ?? key,
  }),
}))

vi.mock('../context/InstallationContext', () => ({
  useInstallation: () => ({
    active: { id: 1, name: 'My pool', type: 'pool', role: 'owner' },
    isOwner: true,
    canEdit: true,
  }),
}))

const task = (overrides: Partial<MaintenanceTask> = {}): MaintenanceTask => ({
  id: 10,
  key: 'filter_maintenance',
  builtin_key: 'filter_maintenance',
  label: 'Filter maintenance',
  icon: 'mdi:air-filter',
  action_types: ['Backwash'],
  interval_days: 14,
  enabled: true,
  sort_order: 0,
  days_until_due: -2,
  last_date: '2026-07-10',
  ...overrides,
})

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('MaintenancePage', () => {
  it('renders enabled tasks with a localized name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [task()],
    } as Response)

    render(<MaintenancePage />)

    await waitFor(() => expect(screen.getByText('Entretien du filtre')).toBeInTheDocument())
    // Overdue by 2 days shows the overdue status chip.
    expect(screen.getByText(/En retard/)).toBeInTheDocument()
  })

  it('marks a task done and updates its status from the response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [task()] } as Response)
    // The completion response: due date reset to a full interval out.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => task({ days_until_due: 14, last_date: '2026-07-21' }),
    } as Response)

    const onActionLogged = vi.fn()
    render(<MaintenancePage onActionLogged={onActionLogged} />)

    await waitFor(() => expect(screen.getByText('Entretien du filtre')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Marquer comme fait'))

    await waitFor(() => expect(onActionLogged).toHaveBeenCalled())
    // The complete endpoint was POSTed for task 10.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/installations/1/maintenance/10/complete',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('hides disabled tasks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [task({ enabled: false })],
    } as Response)

    render(<MaintenancePage />)

    await waitFor(() => expect(screen.getByText(translations.fr.maint_empty)).toBeInTheDocument())
    expect(screen.queryByText('Entretien du filtre')).not.toBeInTheDocument()
  })

  it('shows on-demand tasks as such, never as "never done"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [task({
        id: 20, key: 'purge', builtin_key: 'purge', label: 'Purge',
        action_types: ['Purge'], interval_days: 0,
        days_until_due: null, last_date: null,
      })],
    } as Response)

    render(<MaintenancePage />)

    await waitFor(() => expect(screen.getAllByText(translations.fr.maint_on_demand).length).toBeGreaterThan(0))
    expect(screen.queryByText(translations.fr.maint_never_done)).not.toBeInTheDocument()
  })

  it('draws a task icon from the stored mdi name, whatever the task', async () => {
    // Icons used to be looked up by builtin_key, so anything the user added was
    // stuck with the wrench fallback. They come from `icon` now, like in HA.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [task({
        id: 40, key: 'custom_40', builtin_key: null, label: 'Brosser la ligne d’eau',
        icon: 'mdi:broom', action_types: ['Brosser la ligne d’eau'],
      })],
    } as Response)

    const { container } = render(<MaintenancePage />)

    await waitFor(() => expect(screen.getByText('Brosser la ligne d’eau')).toBeInTheDocument())
    expect(container.querySelector('svg.lucide-brush')).toBeInTheDocument()
    expect(container.querySelector('svg.lucide-wrench')).not.toBeInTheDocument()
  })

  it('falls back to a wrench for an icon it does not know', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [task({ icon: 'mdi:something-only-home-assistant-has' })],
    } as Response)

    const { container } = render(<MaintenancePage />)

    await waitFor(() => expect(screen.getByText('Entretien du filtre')).toBeInTheDocument())
    expect(container.querySelector('svg.lucide-wrench')).toBeInTheDocument()
  })

  it('hands a measurement task off to the entry form instead of logging an empty row', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [task({
        id: 30, key: 'ph_measurement', builtin_key: 'ph_measurement', label: 'pH measurement',
        action_types: ['Measurement', 'pH Measurement'], interval_days: 7, days_until_due: -1,
      })],
    } as Response)

    const onLogEntry = vi.fn()
    render(<MaintenancePage onLogEntry={onLogEntry} />)

    await waitFor(() => expect(screen.getByText('Mesure du pH')).toBeInTheDocument())
    fireEvent.click(screen.getByText(translations.fr.maint_log_entry))

    expect(onLogEntry).toHaveBeenCalledWith('measurement')
    // No completion was POSTed — only the initial task load happened.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
