import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import WaterStatusCard from './WaterStatusCard'
import { LocaleContext } from '../context/LocaleContext'
import { translations } from '../i18n/translations'
import type { Installation } from '../types'

vi.mock('../context/InstallationContext', () => ({
  useInstallation: () => ({
    active: { id: 1, user_id: 1, name: 'My pool', type: 'pool', sanitizer: 'chlorine', created_at: '' } as Installation,
    ranges: null,
    installations: [],
    setActive: vi.fn(),
    refresh: vi.fn(),
    addInstallation: vi.fn(),
  }),
}))

beforeEach(() => {
  // Avoid the 'auto' theme branch, which calls window.matchMedia (unimplemented in jsdom).
  localStorage.setItem('pooly_theme', 'light')
})

describe('WaterStatusCard — English locale', () => {
  it('renders the clear-water label and status in English', () => {
    render(
      <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn(), t: key => (translations.en as Record<string, string>)[key] ?? key }}>
        <WaterStatusCard actions={[]} />
      </LocaleContext.Provider>
    )

    expect(screen.getByText('Clear water')).toBeInTheDocument()
    expect(screen.getByText('● Normal')).toBeInTheDocument()
  })
})
