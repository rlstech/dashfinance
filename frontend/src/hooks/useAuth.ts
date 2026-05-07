import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, LoginResponse } from '@/types'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  setAuth: (user: User, token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      setAuth: (user, token) => set({ user, token, isAuthenticated: true }),

      logout: () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'dashfinance-auth-v1',
      partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated }),
    }
  )
)

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  const BASE_URL = import.meta.env.VITE_API_URL || '/api'
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? 'Credenciais inválidas')
  }
  return res.json()
}
