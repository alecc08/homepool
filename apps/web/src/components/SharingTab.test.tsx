import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SharingTab from './SharingTab'
import { translations } from '../i18n/translations'
import type { Installation } from '../types'

vi.mock('../context/LocaleContext', () => ({
  useT: () => ({
    locale: 'fr',
    setLocale: vi.fn(),
    t: (key: string) => (translations.fr as Record<string, string>)[key] ?? key,
  }),
}))

const installation = {
  id: 7,
  role: 'owner',
  name: 'Ma piscine',
  type: 'pool',
  sanitizer: 'chlorine',
  created_at: '2026-02-25T00:00:00',
} as Installation

const existingShare = {
  id: 3,
  user_id: 2,
  email: 'robin@example.com',
  first_name: 'Robin',
  role: 'viewer',
  created_at: '2026-07-01T00:00:00',
}

function mockFetch(handler: (url: string, init?: RequestInit) => Partial<Response>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) =>
    Promise.resolve(handler(String(url), init as RequestInit) as Response)
  )
}

beforeEach(() => {
  mockFetch(() => ({ ok: true, json: () => Promise.resolve([existingShare]) }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SharingTab', () => {
  it('lists the accounts an installation is shared with', async () => {
    render(<SharingTab installation={installation} />)
    expect(await screen.findByText('Robin')).toBeInTheDocument()
    expect(screen.getByText('robin@example.com')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/installations/7/shares', expect.any(Object))
  })

  it('posts the email and role when sharing', async () => {
    render(<SharingTab installation={installation} />)
    await screen.findByText('Robin')

    mockFetch(() => ({
      ok: true,
      json: () => Promise.resolve({ ...existingShare, id: 4, email: 'sam@example.com', first_name: 'Sam' }),
    }))

    fireEvent.change(screen.getByPlaceholderText('adresse@exemple.com'), {
      target: { value: 'sam@example.com' },
    })
    fireEvent.click(screen.getByText('Partager'))

    await waitFor(() => expect(screen.getByText('Sam')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith(
      '/api/installations/7/shares',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'sam@example.com', role: 'viewer' }),
      })
    )
  })

  it('explains that an unknown email has no account yet', async () => {
    render(<SharingTab installation={installation} />)
    await screen.findByText('Robin')

    mockFetch(() => ({ ok: false, status: 404, json: () => Promise.resolve({}) }))

    fireEvent.change(screen.getByPlaceholderText('adresse@exemple.com'), {
      target: { value: 'nobody@example.com' },
    })
    fireEvent.click(screen.getByText('Partager'))

    expect(await screen.findByText(translations.fr.share_unknown_email)).toBeInTheDocument()
  })

  it('reports an installation already shared with that account', async () => {
    render(<SharingTab installation={installation} />)
    await screen.findByText('Robin')

    mockFetch(() => ({ ok: false, status: 409, json: () => Promise.resolve({}) }))

    fireEvent.change(screen.getByPlaceholderText('adresse@exemple.com'), {
      target: { value: 'robin@example.com' },
    })
    fireEvent.click(screen.getByText('Partager'))

    expect(await screen.findByText(translations.fr.share_already_shared)).toBeInTheDocument()
  })
})
