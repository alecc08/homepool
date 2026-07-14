import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ActionForm from './ActionForm'
import type { Action, Installation } from '../types'
import { translations } from '../i18n/translations'
import { PARAM_RANGES, type DynamicRanges } from '../utils'
import { convertRange, celsiusToFahrenheit } from '../units'

const products = [{ id: 1, name: 'Chlorine', type: 'seed', unit_default: 'g' }]

// Mocked directly rather than mounted via real providers: LocaleContext and
// InstallationContext are both unconditionally required by ActionForm, and the
// real InstallationProvider issues a `fetch('/api/installations')` on mount that
// hangs in jsdom. Mocking keeps these tests fast and deterministic.
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

function makeInstallation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 1,
    user_id: 1,
    name: 'My pool',
    type: 'pool',
    sanitizer: 'chlorine',
    created_at: '2026-01-01T00:00:00',
    ...overrides,
  }
}

function setActiveInstallation(installation: Installation, ranges: DynamicRanges | null = null) {
  mockUseInstallation.mockReturnValue({
    active: installation,
    ranges,
    installations: [installation],
    setActive: vi.fn(),
    refresh: vi.fn(),
    addInstallation: vi.fn(),
  })
}

function makeMesureAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 1,
    date: '2026-02-24',
    action_type: 'Measurement',
    user_id: 1,
    product_id: null,
    qty: '7.4',
    unit: '',
    notes: '',
    created_at: '2026-02-24T00:00:00',
    ...overrides,
  }
}

beforeEach(() => {
  mockUseInstallation.mockReset()
  localStorage.clear()
  localStorage.setItem('pooly_mesure_mode', 'appareil')
})

describe('ActionForm', () => {
  it('calls onAdd with structured payload when submitted', () => {
    setActiveInstallation(makeInstallation())
    const onAdd = vi.fn()
    render(<ActionForm onAdd={onAdd} products={products} />)

    fireEvent.click(screen.getByText('Enregistrer'))

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action_type: expect.any(String),
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      ])
    )
  })

  it('calls onClose after submit when provided', () => {
    setActiveInstallation(makeInstallation())
    const onAdd = vi.fn()
    const onClose = vi.fn()
    render(<ActionForm onAdd={onAdd} products={products} onClose={onClose} />)

    fireEvent.click(screen.getByText('Enregistrer'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sel installation, appareil mode: renders Sel, Chlore libre, Stabilisant and Chlore combiné fields', () => {
    setActiveInstallation(makeInstallation({ sanitizer: 'salt' }))
    const editAction = makeMesureAction()
    render(<ActionForm products={products} editAction={editAction} onEdit={vi.fn()} />)

    expect(screen.getByText('Sel')).toBeInTheDocument()
    expect(screen.getByText('Chlore libre')).toBeInTheDocument()
    expect(screen.getByText('Stabilisant (CYA)')).toBeInTheDocument()
    expect(screen.getByText('Chlore combiné (CC)')).toBeInTheDocument()
  })

  it('chlore installation, appareil mode: renders Chlore combiné field', () => {
    setActiveInstallation(makeInstallation({ sanitizer: 'chlorine' }))
    const editAction = makeMesureAction()
    render(<ActionForm products={products} editAction={editAction} onEdit={vi.fn()} />)

    expect(screen.getByText('Chlore combiné (CC)')).toBeInTheDocument()
  })

  it('brome installation, appareil mode: does not render Chlore combiné field', () => {
    setActiveInstallation(makeInstallation({ sanitizer: 'bromine' }))
    const editAction = makeMesureAction()
    render(<ActionForm products={products} editAction={editAction} onEdit={vi.fn()} />)

    expect(screen.queryByText('Chlore combiné (CC)')).not.toBeInTheDocument()
  })

  it('filling sel/stabilisant/cc fields and submitting includes them in the payload notes', () => {
    setActiveInstallation(makeInstallation({ sanitizer: 'salt' }))
    const editAction = makeMesureAction()
    const onEdit = vi.fn()
    render(<ActionForm products={products} editAction={editAction} onEdit={onEdit} />)

    fireEvent.change(screen.getByPlaceholderText('3000'), { target: { value: '3000' } })
    fireEvent.change(screen.getByPlaceholderText('70'), { target: { value: '70' } })
    fireEvent.change(screen.getByPlaceholderText('0.1'), { target: { value: '0.3' } })

    fireEvent.click(screen.getByText('Enregistrer les modifications'))

    expect(onEdit).toHaveBeenCalledTimes(1)
    const [, payload] = onEdit.mock.calls[0]
    expect(payload.notes).toContain('salt: 3000')
    expect(payload.notes).toContain('stabilizer: 70')
    expect(payload.notes).toContain('combined: 0.3')
  })

  it('bandelette mode for a sel installation does not render a salt/CYA/CC swatch panel, but does render Chlore', () => {
    localStorage.setItem('pooly_mesure_mode', 'bandelette')
    setActiveInstallation(makeInstallation({ sanitizer: 'salt' }))
    const editAction = makeMesureAction()
    render(<ActionForm products={products} editAction={editAction} onEdit={vi.fn()} />)

    expect(screen.queryByText('Sel')).not.toBeInTheDocument()
    expect(screen.queryByText('Stabilisant (CYA)')).not.toBeInTheDocument()
    expect(screen.queryByText('Chlore combiné (CC)')).not.toBeInTheDocument()
    expect(screen.getByText('Chlore libre')).toBeInTheDocument()
  })

  describe('température (unit-aware temperature field)', () => {
    it.each(['bromine', 'chlorine', 'salt'] as const)('appareil mode renders a Température field for %s installations', (sanitizer) => {
      setActiveInstallation(makeInstallation({ sanitizer }))
      const editAction = makeMesureAction()
      render(<ActionForm products={products} editAction={editAction} onEdit={vi.fn()} />)

      expect(screen.getByText('Température')).toBeInTheDocument()
    })

    it('shows a Fahrenheit-range hint and correct in-range status for an installation with temp_unit F', () => {
      const ranges: DynamicRanges = { temp: convertRange(PARAM_RANGES.temp, celsiusToFahrenheit) }
      setActiveInstallation(makeInstallation({ sanitizer: 'chlorine', temp_unit: 'F' }), ranges)
      const editAction = makeMesureAction()
      render(<ActionForm products={products} editAction={editAction} onEdit={vi.fn()} />)

      expect(screen.getByText(/Idéal.*°F/)).toBeInTheDocument()

      const input = screen.getByPlaceholderText('77')
      fireEvent.change(input, { target: { value: '77' } })
      fireEvent.blur(input)

      // 77°F is within the converted ideal range: must NOT be flagged as out-of-range,
      // proving the field compares against Fahrenheit-converted ranges, not raw Celsius ones.
      expect(screen.queryByText('Valeur hors norme')).not.toBeInTheDocument()
      expect(input.getAttribute('style')).not.toContain('var(--status-danger-text)')
    })

    it('submitting with the temperature field filled includes it in the payload notes', () => {
      setActiveInstallation(makeInstallation({ sanitizer: 'chlorine' }))
      const editAction = makeMesureAction()
      const onEdit = vi.fn()
      render(<ActionForm products={products} editAction={editAction} onEdit={onEdit} />)

      fireEvent.change(screen.getByPlaceholderText('25'), { target: { value: '26' } })
      fireEvent.click(screen.getByText('Enregistrer les modifications'))

      expect(onEdit).toHaveBeenCalledTimes(1)
      const [, payload] = onEdit.mock.calls[0]
      expect(payload.notes).toContain('temperature: 26')
    })

    it('edit mode does not leak an existing température note into the visible Notes textarea', () => {
      setActiveInstallation(makeInstallation({ sanitizer: 'chlorine' }))
      const editAction = makeMesureAction({ notes: 'temperature: 26. Clear water' })
      render(<ActionForm products={products} editAction={editAction} onEdit={vi.fn()} />)

      const notes = screen.getByLabelText('Notes') as HTMLTextAreaElement
      expect(notes.value).not.toContain('température')
      expect(notes.value).toContain('Clear water')
    })

    it('bandelette mode renders no temperature swatch panel, for any sanitizer', () => {
      localStorage.setItem('pooly_mesure_mode', 'bandelette')
      setActiveInstallation(makeInstallation({ sanitizer: 'salt' }))
      const editAction = makeMesureAction()
      render(<ActionForm products={products} editAction={editAction} onEdit={vi.fn()} />)

      expect(screen.queryByText('Température')).not.toBeInTheDocument()
    })
  })

  describe('edit mode round-trip (regression: rowFromAction must re-fill every field, not just pH)', () => {
    it('re-populates every appareil-mode field with its real saved value, not the placeholder', () => {
      setActiveInstallation(makeInstallation({ sanitizer: 'salt', temp_unit: 'F' }))
      // Notes built the same way toPayload (ActionForm.tsx) would for a sel installation
      // with every field filled — this is the exact shape a real save produces.
      const editAction = makeMesureAction({
        qty: '7',
        notes: 'chlorine: 1.5. TAC: 120. hardness: 250. salt: 3200. stabilizer: 65. combined: 0.1. temperature: 82. Clear water. Level OK',
      })
      render(<ActionForm products={products} editAction={editAction} onEdit={vi.fn()} />)

      expect((screen.getByPlaceholderText('7.2') as HTMLInputElement).value).toBe('7')
      expect((screen.getByPlaceholderText('3000') as HTMLInputElement).value).toBe('3200')
      expect((screen.getByPlaceholderText('1.5') as HTMLInputElement).value).toBe('1.5')
      expect((screen.getByPlaceholderText('120') as HTMLInputElement).value).toBe('120')
      expect((screen.getByPlaceholderText('250') as HTMLInputElement).value).toBe('250')
      expect((screen.getByPlaceholderText('70') as HTMLInputElement).value).toBe('65')
      expect((screen.getByPlaceholderText('0.1') as HTMLInputElement).value).toBe('0.1')
      // Placeholder is unit-aware (77 = round(celsiusToFahrenheit(25))) for a °F installation.
      expect((screen.getByPlaceholderText('77') as HTMLInputElement).value).toBe('82')

      const notes = screen.getByLabelText('Notes') as HTMLTextAreaElement
      expect(notes.value).toBe('Clear water. Level OK')
    })
  })
})
