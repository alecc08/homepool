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
  it('renders nav labels and the mid-button label in English', () => {
    renderEnglish()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Measurements')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('renders the English aria-label on the add button', () => {
    renderEnglish()
    expect(screen.getByLabelText('New entry')).toBeInTheDocument()
  })
})
