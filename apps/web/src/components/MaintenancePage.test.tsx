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
  useInstallation: () => ({ active: { id: 1, name: 'My pool', type: 'pool' } }),
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
})
