import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TreatmentConfig from './TreatmentConfig'
import { translations } from '../i18n/translations'
import type { Installation, TreatmentProduct } from '../types'

vi.mock('../context/LocaleContext', () => ({
  useT: () => ({
    locale: 'fr',
    setLocale: vi.fn(),
    t: (key: string) => (translations.fr as Record<string, string>)[key] ?? key,
  }),
}))

const installation: Installation = {
  id: 1,
  role: 'owner',
  name: 'My pool',
  type: 'pool',
  sanitizer: 'chlorine',
  created_at: '2026-01-01T00:00:00',
}

const seeded: TreatmentProduct = {
  id: 10,
  key: 'algaecide',
  builtin_key: 'algaecide',
  label: 'Algaecide',
  icon: 'mdi:spray-bottle',
  default_unit: 'ml',
  param: null,
  dosage_product_id: null,
  enabled: true,
  sort_order: 0,
}

const added: TreatmentProduct = {
  ...seeded,
  id: 11,
  key: 'custom_11',
  builtin_key: null,
  label: 'Algimycin 600',
  icon: 'mdi:flask',
  default_unit: 'L',
  sort_order: 1,
}

function mockProducts(products: TreatmentProduct[]) {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  fetchMock.mockResolvedValue({ ok: true, json: async () => products } as Response)
  return fetchMock
}

function renderConfig(products: TreatmentProduct[] = [seeded, added]) {
  const fetchMock = mockProducts(products)
  const onSaved = vi.fn()
  render(<TreatmentConfig installation={installation} onSaved={onSaved} />)
  return { fetchMock, onSaved }
}

// The add-product row reuses the same aria-label as the product rows; only it
// has a placeholder, which is what tells the two apart.
const productNames = () =>
  (screen.getAllByLabelText(translations.fr.treat_product_name) as HTMLInputElement[])
    .filter(input => !input.placeholder)

const saveButton = () => screen.getByText(translations.fr.treat_save)

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('TreatmentConfig', () => {
  it('shows seeded products under their translated name', async () => {
    renderConfig()
    await waitFor(() => expect(productNames()).toHaveLength(2))

    // The seeded product resolves through its builtin_key, the custom one
    // shows exactly what is stored.
    expect(productNames()[0].value).toBe('Anti-algues')
    expect(productNames()[1].value).toBe('Algimycin 600')
  })

  it('renames a seeded product with a PATCH', async () => {
    const { fetchMock } = renderConfig()
    await waitFor(() => expect(productNames()).toHaveLength(2))

    fireEvent.change(productNames()[0], { target: { value: 'Algimycin 600' } })
    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/installations/1/treatments/10',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PATCH')!
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ label: 'Algimycin 600' })
  })

  it('does not send an untouched label, so a seeded product stays translatable', async () => {
    // PATCHing the current locale's string would clear builtin_key server-side
    // and freeze the product's name in whichever language it was saved from.
    const { fetchMock } = renderConfig()
    await waitFor(() => expect(productNames()).toHaveLength(2))

    fireEvent.click(screen.getAllByLabelText(translations.fr.treat_enabled_label)[0])
    fireEvent.click(saveButton())

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PATCH')
      expect(call).toBeDefined()
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ enabled: false })
    })
  })

  it('deletes a product', async () => {
    const { fetchMock } = renderConfig()
    await waitFor(() => expect(productNames()).toHaveLength(2))

    fireEvent.click(screen.getAllByLabelText(translations.fr.treat_delete)[1])
    expect(productNames()).toHaveLength(1)

    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/installations/1/treatments/11',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })

  it('adds a custom product with the chosen icon and unit', async () => {
    const { fetchMock } = renderConfig()
    await waitFor(() => expect(productNames()).toHaveLength(2))

    const newInput = screen.getByPlaceholderText(translations.fr.treat_product_name_placeholder)
    fireEvent.change(newInput, { target: { value: 'Pond juice' } })
    fireEvent.click(screen.getByText(translations.fr.treat_add))
    fireEvent.click(saveButton())

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
      expect(call).toBeDefined()
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
        label: 'Pond juice',
        icon: 'mdi:beaker-plus',
        default_unit: 'g',
        param: null,
      })
    })
  })

  it('sends nothing when nothing changed', async () => {
    const { fetchMock, onSaved } = renderConfig()
    await waitFor(() => expect(productNames()).toHaveLength(2))
    const before = fetchMock.mock.calls.length

    fireEvent.click(saveButton())

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(fetchMock.mock.calls).toHaveLength(before)
  })

  it('surfaces a load failure instead of showing an empty catalog', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response)
    render(<TreatmentConfig installation={installation} />)

    await waitFor(() =>
      expect(screen.getByText(translations.fr.treat_load_error)).toBeInTheDocument()
    )
  })
})
