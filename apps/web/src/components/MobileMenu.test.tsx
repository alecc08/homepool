import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MobileMenu from './MobileMenu'
import { translations } from '../i18n/translations'
import type { Installation } from '../types'

vi.mock('../context/LocaleContext', () => ({
  useT: () => ({
    locale: 'en',
    setLocale: vi.fn(),
    t: (key: string) => (translations.en as Record<string, string>)[key] ?? key,
  }),
}))

const mockUseInstallation = vi.fn()
vi.mock('../context/InstallationContext', () => ({
  useInstallation: () => mockUseInstallation(),
}))

function makeInstallation(id: number, name: string, type: 'pool' | 'spa' = 'pool'): Installation {
  return {
    id,
    name,
    type,
    sanitizer: type === 'spa' ? 'bromine' : 'chlorine',
    role: 'owner',
    owner_name: 'Demo',
    volume: 50000,
    volume_unit: 'L',
    temp_unit: 'C',
  } as unknown as Installation
}

const poolA = makeInstallation(1, 'My pool')
const spaB = makeInstallation(2, 'Hot tub', 'spa')

beforeEach(() => {
  mockUseInstallation.mockReset()
  mockUseInstallation.mockReturnValue({
    installations: [poolA, spaB],
    active: poolA,
    ranges: null,
    isOwner: true,
    canEdit: true,
    setActive: vi.fn(),
    deleteInstallation: vi.fn(),
  })
})

describe('MobileMenu — the phone’s replacement for the sidebar', () => {
  it('lets you switch pools without leaving the phone (issue #72)', async () => {
    const setActive = vi.fn()
    mockUseInstallation.mockReturnValue({
      installations: [poolA, spaB], active: poolA, isOwner: true, canEdit: true,
      setActive, deleteInstallation: vi.fn(),
    })

    render(<MobileMenu open onClose={vi.fn()} onEditInstallation={vi.fn()} theme="dark" />)

    const selector = screen.getByLabelText('MY INSTALLATION')
    expect(selector.tagName).toBe('SELECT')
    expect(screen.getAllByRole('option').map(o => o.textContent))
      .toEqual(['My pool', 'Hot tub'])

    // Choosing the other pool switches the active installation.
    fireEvent.change(selector, { target: { value: '2' } })
    await waitFor(() => expect(setActive).toHaveBeenCalledWith(2))
  })

  it('reaches pool settings from the phone (issue #72)', () => {
    const onEditInstallation = vi.fn()
    render(<MobileMenu open onClose={vi.fn()} onEditInstallation={onEditInstallation} theme="dark" />)
    // The pencil opens the same installation dialog the desktop sidebar uses.
    fireEvent.click(screen.getByLabelText('Edit installation'))
    expect(onEditInstallation).toHaveBeenCalledTimes(1)
  })

  it('lets you add a pool and exposes delete for the owner', () => {
    const onAddInstallation = vi.fn()
    render(<MobileMenu open onClose={vi.fn()} onAddInstallation={onAddInstallation} theme="dark" />)
    fireEvent.click(screen.getByText(/\+ Add installation/))
    expect(onAddInstallation).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Delete installation')).toBeInTheDocument()
  })

  it('shows a non-owner the details view and no delete', () => {
    const onEditInstallation = vi.fn()
    mockUseInstallation.mockReturnValue({
      installations: [poolA], active: poolA, isOwner: false, canEdit: false,
      setActive: vi.fn(), deleteInstallation: vi.fn(),
    })
    render(<MobileMenu open onClose={vi.fn()} onEditInstallation={onEditInstallation} theme="dark" />)
    // Non-owner gets "Installation details", never "Edit installation" / delete.
    expect(screen.getByLabelText('Installation details')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit installation')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Delete installation')).not.toBeInTheDocument()
  })

  it('hides the logout entry when there is nothing to log out of', () => {
    render(<MobileMenu open onClose={vi.fn()} theme="dark" />)
    expect(screen.queryByText('Log out')).not.toBeInTheDocument()
  })
})
