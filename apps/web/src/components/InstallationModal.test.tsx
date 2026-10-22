import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import InstallationModal from './InstallationModal'
import { translations } from '../i18n/translations'
import type { Installation } from '../types'

vi.mock('../context/LocaleContext', () => ({
  useT: () => ({
    locale: 'fr',
    setLocale: vi.fn(),
    t: (key: string) => (translations.fr as Record<string, string>)[key] ?? key,
  }),
}))

const mockAddInstallation = vi.fn()
const mockRefresh = vi.fn()
vi.mock('../context/InstallationContext', () => ({
  useInstallation: () => ({
    installations: [],
    active: null,
    ranges: null,
    isOwner: true,
    canEdit: true,
    setActive: vi.fn(),
    refresh: mockRefresh,
    addInstallation: mockAddInstallation,
    leaveInstallation: vi.fn(),
  }),
}))

const makeInstallation = (overrides: Partial<Installation> = {}): Installation => ({
  id: 3,
  role: 'owner',
  name: 'Backyard pool',
  type: 'pool',
  sanitizer: 'chlorine',
  created_at: '2026-01-01T00:00:00',
  ...overrides,
})

/** Submits and reads back the body of the PATCH the edit form posts. */
const submitEdit = async (fetchMock: ReturnType<typeof vi.fn>) => {
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const [url, init] = fetchMock.mock.calls[0]
  return { url, method: init.method, body: JSON.parse(init.body) }
}

beforeEach(() => {
  mockAddInstallation.mockReset()
  mockAddInstallation.mockResolvedValue({ id: 1 })
})

describe('InstallationModal', () => {
  it('submits with volume and unit when provided', async () => {
    render(<InstallationModal open onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Ma piscine' } })
    fireEvent.change(screen.getByPlaceholderText('45000'), { target: { value: '45000' } })
    fireEvent.click(screen.getByText('gal'))
    fireEvent.click(screen.getByText("Créer l'installation"))

    await waitFor(() => expect(mockAddInstallation).toHaveBeenCalledTimes(1))
    expect(mockAddInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ volume: 45000, volume_unit: 'gal' })
    )
  })

  it('omits volume when left empty', async () => {
    render(<InstallationModal open onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Ma piscine' } })
    fireEvent.click(screen.getByText("Créer l'installation"))

    await waitFor(() => expect(mockAddInstallation).toHaveBeenCalledTimes(1))
    const arg = mockAddInstallation.mock.calls[0][0]
    expect(arg.volume).toBeUndefined()
  })

  it('submits optional contact fields when provided', async () => {
    render(<InstallationModal open onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Ma piscine' } })
    fireEvent.change(screen.getByPlaceholderText('Adresse'), { target: { value: '123 rue Principale' } })
    fireEvent.change(screen.getByPlaceholderText('Nom du contact'), { target: { value: 'Jean Tremblay' } })
    fireEvent.change(screen.getByPlaceholderText('Téléphone'), { target: { value: '555-1234' } })
    fireEvent.change(screen.getByPlaceholderText('Courriel'), { target: { value: 'jean@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Notes'), { target: { value: 'Portail à gauche' } })
    fireEvent.click(screen.getByText("Créer l'installation"))

    await waitFor(() => expect(mockAddInstallation).toHaveBeenCalledTimes(1))
    expect(mockAddInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '123 rue Principale',
        contact_name: 'Jean Tremblay',
        phone: '555-1234',
        email: 'jean@example.com',
        notes: 'Portail à gauche',
      })
    )
  })

  it('omits contact fields when left empty', async () => {
    render(<InstallationModal open onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Ma piscine' } })
    fireEvent.click(screen.getByText("Créer l'installation"))

    await waitFor(() => expect(mockAddInstallation).toHaveBeenCalledTimes(1))
    const arg = mockAddInstallation.mock.calls[0][0]
    expect(arg.address).toBeUndefined()
    expect(arg.contact_name).toBeUndefined()
    expect(arg.phone).toBeUndefined()
    expect(arg.email).toBeUndefined()
    expect(arg.notes).toBeUndefined()
  })
})

describe('season state', () => {
  const createPayload = async () => {
    fireEvent.click(screen.getByText("Créer l'installation"))
    await waitFor(() => expect(mockAddInstallation).toHaveBeenCalledTimes(1))
    return mockAddInstallation.mock.calls[0][0] as Record<string, unknown>
  }

  beforeEach(() => {
    mockRefresh.mockReset()
  })

  it('creates a new pool open for the season', async () => {
    render(<InstallationModal open onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Ma piscine' } })

    const payload = await createPayload()
    expect(payload.is_open).toBe(true)
  })

  it('creates a pool closed for the season when that is picked first', async () => {
    render(<InstallationModal open onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Ma piscine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fermée' }))

    const payload = await createPayload()
    expect(payload.is_open).toBe(false)
  })

  it('preselects the season of the pool being edited', () => {
    render(<InstallationModal open onClose={vi.fn()} installation={makeInstallation({ is_open: false })} />)

    expect(screen.getByRole('button', { name: 'Fermée' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Ouverte' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('patches the season state and refreshes the installations when it changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<InstallationModal open onClose={vi.fn()} installation={makeInstallation({ is_open: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fermée' }))

    const { url, method, body } = await submitEdit(fetchMock)
    expect(url).toBe('/api/installations/3')
    expect(method).toBe('PATCH')
    expect(body.is_open).toBe(false)
    expect(body.name).toBe('Backyard pool')
    expect(mockRefresh).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('shows a shared pool\'s season read-only, with no switch to press', () => {
    render(
      <InstallationModal
        open
        onClose={vi.fn()}
        installation={makeInstallation({ role: 'viewer', is_open: false })}
      />,
    )

    expect(screen.getByText('Fermée')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fermée' })).toBeNull()
  })
})
