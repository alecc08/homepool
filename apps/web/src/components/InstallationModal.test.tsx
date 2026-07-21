import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import InstallationModal from './InstallationModal'
import { translations } from '../i18n/translations'

vi.mock('../context/LocaleContext', () => ({
  useT: () => ({
    locale: 'fr',
    setLocale: vi.fn(),
    t: (key: string) => (translations.fr as Record<string, string>)[key] ?? key,
  }),
}))

const mockAddInstallation = vi.fn()
vi.mock('../context/InstallationContext', () => ({
  useInstallation: () => ({
    installations: [],
    active: null,
    ranges: null,
    setActive: vi.fn(),
    refresh: vi.fn(),
    addInstallation: mockAddInstallation,
  }),
}))

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
