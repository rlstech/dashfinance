import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
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
  const [showPassword, setShowPassword] = useState(false)
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
    <div className="flex min-h-screen items-center justify-center bg-bgBase p-4 md:p-8">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-white shadow-panel md:grid-cols-[0.85fr_1.15fr]">
        <section className="hidden flex-col justify-between bg-sidebar p-9 text-white md:flex">
          <div>
            <p className="text-[17px] font-bold tracking-[-0.03em]">Dashfinance<span className="text-brand">.</span></p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Sala de controle</p>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-brand">Acesso interno</p>
            <h1 className="max-w-xs text-3xl font-semibold leading-tight tracking-[-0.04em]">
              Dados financeiros por empresa, obra e período.
            </h1>
            <p className="mt-5 max-w-xs text-sm leading-6 text-white/58">
              Entre para consultar o escopo autorizado e acompanhar a operação.
            </p>
          </div>
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">UAU · DashFinance</p>
        </section>

        <form onSubmit={handleSubmit} aria-labelledby="login-title" className="space-y-6 p-6 sm:p-9">
          <div>
            <p className="section-label">Acesso ao sistema</p>
            <h2 id="login-title" className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-dark">Entrar</h2>
            <p className="mt-2 text-sm text-muted-foreground">Use seu e-mail e senha para continuar.</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="email" className="text-xs font-semibold text-dark">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="h-11 w-full rounded-md border border-line bg-white px-3 text-sm text-dark outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
              placeholder="seu@email.com"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-xs font-semibold text-dark">
              Senha
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 w-full rounded-md border border-line bg-white px-3 pr-10 text-sm text-dark outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
                placeholder="Sua senha"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Ocultar senha' : 'Revelar senha'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-bgBase hover:text-dark"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-negative">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-md bg-dark px-4 text-sm font-semibold text-white transition-colors hover:bg-brand hover:text-dark disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
