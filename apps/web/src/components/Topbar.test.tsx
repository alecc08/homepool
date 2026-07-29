import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Topbar from './Topbar'
import { translations } from '../i18n/translations'
import type { User } from '../types'

vi.mock('../context/LocaleContext', () => ({
  useT: () => ({
    locale: 'fr',
    setLocale: vi.fn(),
    t: (key: string) => (translations.fr as Record<string, string>)[key] ?? key,
  }),
}))

const mockUseInstallation = vi.fn()
vi.mock('../context/InstallationContext', () => ({
  useInstallation: () => mockUseInstallation(),
}))

const user: User = {
  id: 1,
  email: 'admin@example.com',
  first_name: 'Alec',
  is_admin: false,
  created_at: '2026-01-01T00:00:00',
}

function renderTopbar(props: Partial<React.ComponentProps<typeof Topbar>> = {}) {
  render(
    <Topbar
      onLogout={vi.fn()}
      onProfile={vi.fn()}
      page="log"
      onNavigate={vi.fn()}
      user={user}
      {...props}
    />
  )
}

beforeEach(() => {
  mockUseInstallation.mockReturnValue({
    active: null,
    ranges: null,
    installations: [],
    setActive: vi.fn(),
    refresh: vi.fn(),
    addInstallation: vi.fn(),
  })
})

describe('Topbar sidebar', () => {
  it('puts logging an entry at the top of the nav, not just on the dashboard', () => {
    const onAdd = vi.fn()
    renderTopbar({ onAdd })

    const button = screen.getByText(translations.fr.nav_new_entry)
    fireEvent.click(button)
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('omits the add button for someone with nothing to log', () => {
    // App passes onAdd only when the current role can write; a viewer gets none.
    renderTopbar({ onAdd: undefined })

    expect(screen.queryByText(translations.fr.nav_new_entry)).not.toBeInTheDocument()
    // The rest of the nav still renders.
    expect(screen.getByText(translations.fr.nav_measurements)).toBeInTheDocument()
  })
})
