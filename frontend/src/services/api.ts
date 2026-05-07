import { useAuthStore } from '@/hooks/useAuth'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private getHeaders(): Record<string, string> {
    const token = useAuthStore.getState().token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin)
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          url.searchParams.append(key, String(value))
        }
      })
    }
    const response = await fetch(url.toString(), { headers: this.getHeaders() })
    if (response.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
      throw new Error('Sessão expirada')
    }
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  async put<T>(path: string, body: unknown): Promise<T | null> {
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin)
    const response = await fetch(url.toString(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...this.getHeaders() },
      body: JSON.stringify(body),
    })
    if (response.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
      throw new Error('Sessão expirada')
    }
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }
    if (response.status === 204) return null
    return response.json()
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin)
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.getHeaders() },
      body: JSON.stringify(body),
    })
    if (response.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
      throw new Error('Sessão expirada')
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.detail ?? `API Error: ${response.status}`)
    }
    return response.json()
  }

  async delete(path: string): Promise<void> {
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin)
    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: this.getHeaders(),
    })
    if (response.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
      throw new Error('Sessão expirada')
    }
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }
  }
}

export const api = new ApiClient(BASE_URL)
