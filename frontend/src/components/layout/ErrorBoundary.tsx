import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  info: ErrorInfo | null
}

/**
 * Envolve o conteúdo de cada página (dentro do MainLayout, fora da sidebar/header).
 * Se uma página quebrar em runtime, mostra o erro em vez de deixar a tela em branco —
 * a barra lateral e o header continuam funcionando normalmente.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info })
    console.error('[ErrorBoundary] Página travou:', error, info.componentStack)
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full min-h-0 items-start justify-center overflow-auto p-5 md:p-7">
        <div className="data-panel w-full max-w-2xl space-y-4 p-6">
          <div>
            <p className="section-label text-red-500">Erro nesta página</p>
            <h1 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-dark">
              Algo quebrou ao carregar esta tela
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Tire um print desta mensagem e envie para o suporte — isso ajuda a identificar a causa.
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Mensagem</p>
            <p className="break-words rounded-md bg-secondary p-3 text-xs font-mono text-dark">
              {error.message || String(error)}
            </p>
          </div>

          {(error.stack || info?.componentStack) && (
            <details className="text-xs">
              <summary className="cursor-pointer font-semibold text-muted-foreground">
                Detalhes técnicos
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-secondary p-3 font-mono text-[11px] text-muted-foreground">
                {error.stack}
                {info?.componentStack}
              </pre>
            </details>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-dark px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark"
            >
              Recarregar página
            </button>
            <a
              href="/"
              className="flex items-center rounded-md border border-line px-4 py-2 text-xs font-semibold text-dark transition-colors hover:border-brand hover:bg-brand hover:text-dark"
            >
              Voltar ao Dashboard
            </a>
          </div>
        </div>
      </div>
    )
  }
}
