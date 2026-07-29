import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MaintenanceConfig from './MaintenanceConfig'
import { translations } from '../i18n/translations'
import type { MaintenanceTask } from '../types'

vi.mock('../context/LocaleContext', () => ({
  useT: () => ({
    locale: 'fr',
    setLocale: vi.fn(),
    t: (key: string) => (translations.fr as Record<string, string>)[key] ?? key,
  }),
}))

const seeded: MaintenanceTask = {
  id: 10,
  key: 'filter_maintenance',
  builtin_key: 'filter_maintenance',
  label: 'Filter maintenance',
  icon: 'mdi:air-filter',
  action_types: ['Backwash'],
  interval_days: 14,
  enabled: true,
  sort_order: 0,
  days_until_due: 5,
  last_date: '2026-07-20',
}

const added: MaintenanceTask = {
  ...seeded,
  id: 11,
  key: 'custom_11',
  builtin_key: null,
  label: 'Vacuum floor',
  icon: 'mdi:broom',
  action_types: ['Vacuum floor'],
  sort_order: 1,
}

function mockTasks(tasks: MaintenanceTask[]) {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  fetchMock.mockResolvedValue({ ok: true, json: async () => tasks } as Response)
  return fetchMock
}

function renderConfig(tasks: MaintenanceTask[] = [seeded, added]) {
  const fetchMock = mockTasks(tasks)
  const onSaved = vi.fn()
  render(
    <MaintenanceConfig installationId={1} open onClose={vi.fn()} onSaved={onSaved} />
  )
  return { fetchMock, onSaved }
}

// The add-task row reuses the same aria-label as the task rows; only it has a
// placeholder, which is what tells the two apart.
const taskNames = () =>
  (screen.getAllByLabelText(translations.fr.maint_task_name) as HTMLInputElement[])
    .filter(input => !input.placeholder)

const newTaskName = () => screen.getByPlaceholderText(translations.fr.maint_task_name_placeholder)

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('MaintenanceConfig', () => {
  it('makes every task editable, seeded ones included', async () => {
    renderConfig()

    // Both rows expose a name input and a delete button — there is no
    // "built-in, look but do not touch" row any more.
    await waitFor(() => expect(taskNames()).toHaveLength(2))
    expect(taskNames().map(i => i.value)).toEqual(['Entretien du filtre', 'Vacuum floor'])
    expect(screen.getAllByLabelText(translations.fr.maint_delete)).toHaveLength(2)
  })

  it('renames a seeded task through PATCH', async () => {
    const { fetchMock } = renderConfig([seeded])
    await waitFor(() => expect(taskNames()).toHaveLength(1))

    fireEvent.change(taskNames()[0], { target: { value: 'Contre-lavage' } })
    fireEvent.click(screen.getByText(translations.fr.maint_save))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/installations/1/maintenance/10',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ label: 'Contre-lavage' }),
        }),
      )
    )
  })

  it('deletes a seeded task', async () => {
    const { fetchMock } = renderConfig([seeded])
    await waitFor(() => expect(taskNames()).toHaveLength(1))

    fireEvent.click(screen.getByLabelText(translations.fr.maint_delete))
    fireEvent.click(screen.getByText(translations.fr.maint_save))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/installations/1/maintenance/10',
        expect.objectContaining({ method: 'DELETE' }),
      )
    )
  })

  it('leaves an untouched seeded label alone, so its translation survives', async () => {
    // The input is pre-filled with the *translated* name. Saving without editing
    // it must not PATCH that string back and freeze the task into French.
    const { fetchMock } = renderConfig([seeded])
    await waitFor(() => expect(taskNames()).toHaveLength(1))

    fireEvent.change(screen.getByDisplayValue('14'), { target: { value: '21' } })
    fireEvent.click(screen.getByText(translations.fr.maint_save))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/installations/1/maintenance/10',
        expect.objectContaining({ body: JSON.stringify({ interval_days: 21 }) }),
      )
    )
  })

  it('creates a new task with its chosen icon', async () => {
    const { fetchMock } = renderConfig([seeded])
    await waitFor(() => expect(taskNames()).toHaveLength(1))

    fireEvent.change(newTaskName(), { target: { value: 'Brosser la ligne d’eau' } })
    fireEvent.click(screen.getByText(translations.fr.maint_add))
    fireEvent.click(screen.getByText(translations.fr.maint_save))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/installations/1/maintenance',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            label: 'Brosser la ligne d’eau',
            interval_days: 7,
            icon: 'mdi:calendar-clock',
          }),
        }),
      )
    )
  })
})
