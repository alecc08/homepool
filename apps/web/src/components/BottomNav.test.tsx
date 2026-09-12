import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import BottomNav from './BottomNav'
import { LocaleContext } from '../context/LocaleContext'
import { translations } from '../i18n/translations'

function renderEnglish() {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn(), t: key => (translations.en as Record<string, string>)[key] ?? key }}>
      <BottomNav page="log" onNavigate={vi.fn()} onAdd={vi.fn()} />
    </LocaleContext.Provider>
  )
}

describe('BottomNav — English locale', () => {
  it('renders nav labels in English', () => {
    renderEnglish()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Measurements')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
  })

  it('renders the English aria-label on the add button', () => {
    renderEnglish()
    expect(screen.getByLabelText('New entry')).toBeInTheDocument()
  })

  it('hides behind the settings sheet when asked', () => {
    const { container } = render(
      <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn(), t: key => (translations.en as Record<string, string>)[key] ?? key }}>
        <BottomNav page="log" onNavigate={vi.fn()} onAdd={vi.fn()} hidden />
      </LocaleContext.Provider>
    )
    expect((container.querySelector('.bottom-nav') as HTMLElement).className).toContain('mm-hidden')
  })
})
