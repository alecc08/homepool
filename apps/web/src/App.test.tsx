import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import App from './App'

const mockUser = { id: 1, email: 'admin@example.com', created_at: '2026-02-25T00:00:00' }
const mockActions = [
  {
    id: 1,
    date: '2026-02-23',
    action_type: 'Nettoyage cartouche',
    user_id: 1,
    product_id: null,
    qty: '',
    unit: '',
    notes: 'Filtre propre',
    created_at: '2026-02-23T00:00:00',
  },
]
const mockProducts = [{ id: 1, name: 'Chlore', type: 'seed', unit_default: 'g' }]
const mockInstallation = {
  id: 1,
  user_id: 1,
  name: 'Piscine',
  type: 'piscine' as const,
  sanitizer: 'chlore' as const,
  created_at: '2026-02-25T00:00:00',
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = String(url)
      if (u === '/api/me') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: mockUser }) } as Response)
      }
      if (u === '/api/installations') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([mockInstallation]) } as Response)
      }
      if (u.startsWith('/api/installations/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
      }
      if (u.startsWith('/api/actions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockActions) } as Response)
      }
      if (u === '/api/products') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProducts) } as Response)
      }
      return Promise.reject(new Error(`fetch inattendu : ${u}`))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches user, actions and products on mount', async () => {
    render(<App />)
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/me', expect.any(Object))
      expect(fetch).toHaveBeenCalledWith(`/api/actions?installation_id=${mockInstallation.id}`, expect.any(Object))
      expect(fetch).toHaveBeenCalledWith('/api/products', expect.any(Object))
    })
  })
})
