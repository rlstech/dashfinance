import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore, loginRequest } from '@/hooks/useAuth'
import { useFilterStore } from '@/hooks/useFilters'

export default function Login() {
  useEffect(() => { document.title = 'Login | DashFinance' }, [])
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { setAuth, isAuthenticated } = useAuthStore()
  const resetFilters = useFilterStore((s) => s.resetFilters)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true })
  }, [isAuthenticated, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await loginRequest(email, password)
      queryClient.clear()
      resetFilters()
      setAuth(res.user, res.access_token)
      navigate('/', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bgBase flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-black tracking-tighter text-dark uppercase">
            Dashfinance<span className="text-brand">_</span>
          </h1>
          <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest mt-1">
            Dashboard Financeiro
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white block-border shadow-hard p-8 space-y-5">
          <h2 className="text-sm font-black uppercase tracking-widest">Acesso ao Sistema</h2>

          <div className="space-y-1">
            <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full border-2 border-dark px-3 py-2 text-sm font-medium focus:outline-none focus:border-brand bg-white"
              placeholder="seu@email.com"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border-2 border-dark px-3 py-2 text-sm font-medium focus:outline-none focus:border-brand bg-white"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-dark text-white text-xs font-black uppercase tracking-widest px-4 py-3 hover:bg-brand hover:text-dark transition-colors disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
