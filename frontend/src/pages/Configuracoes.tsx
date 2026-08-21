import { startTransition, useEffect, useState, useCallback } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useStatus, useFilterTree, useSaldoConfig, useSaveSaldos } from '@/hooks/useFinanceiro'
import { useAuthStore } from '@/hooks/useAuth'
import { EMPRESA_COLORS } from '@/types'
import { formatCurrency, parseBRLInput } from '@/lib/formatters'
import type { SaldoConfig } from '@/types'

function buildKey(banco: string, conta: string) {
  return `${banco}|${conta}`
}

export default function Configuracoes() {
  useEffect(() => { document.title = 'Configurações | DashFinance' }, [])
  const { data: status } = useStatus()
  const { data: filterTree, isLoading: treeLoading } = useFilterTree()
  const { data: savedSaldos, isLoading: saldosLoading } = useSaldoConfig()
  const saveSaldos = useSaveSaldos()
  const { user } = useAuthStore()

  // Local editable state, seeded from API data
  const [localSaldos, setLocalSaldos] = useState<Record<string, SaldoConfig>>({})

  useEffect(() => {
    if (!savedSaldos) return
    const map: Record<string, SaldoConfig> = {}
    for (const s of savedSaldos) {
      map[`${s.empresa}|${buildKey(s.banco, s.conta)}`] = s
    }
    startTransition(() => setLocalSaldos(map))
  }, [savedSaldos])

  const getConfig = useCallback(
    (empresa: string, banco: string, conta: string): SaldoConfig => {
      const key = `${empresa}|${buildKey(banco, conta)}`
      return localSaldos[key] ?? { empresa, banco, conta, enabled: false, saldo: 0 }
    },
    [localSaldos]
  )

  const isEmpresaEnabled = useCallback(
    (empresa: string) => {
      const contasPorBanco = filterTree?.contas_por_empresa_banco?.[empresa] ?? {}
      return Object.entries(contasPorBanco).some(([banco, contas]) =>
        (contas as string[]).some((conta) => getConfig(empresa, banco, conta).enabled)
      )
    },
    [filterTree, getConfig]
  )

  function toggleEmpresa(empresa: string, enabled: boolean) {
    const contasPorBanco = filterTree?.contas_por_empresa_banco?.[empresa] ?? {}
    setLocalSaldos((prev) => {
      const next = { ...prev }
      Object.entries(contasPorBanco).forEach(([banco, contas]) => {
        ;(contas as string[]).forEach((conta) => {
          const k = `${empresa}|${buildKey(banco, conta)}`
          next[k] = { ...getConfig(empresa, banco, conta), enabled }
        })
      })
      return next
    })
  }

  function updateSaldo(empresa: string, banco: string, conta: string, saldo: number) {
    const k = `${empresa}|${buildKey(banco, conta)}`
    setLocalSaldos((prev) => ({
      ...prev,
      [k]: { ...getConfig(empresa, banco, conta), saldo },
    }))
  }

  function handleSave() {
    const items = Object.values(localSaldos)
    saveSaldos.mutate(items)
  }

  const EMPRESAS = Object.keys(EMPRESA_COLORS)
  const isAdmin = user?.is_admin ?? false
  const isLoading = saldosLoading || treeLoading

  return (
    <div className="flex h-full min-h-0">
      <div className="w-full overflow-auto p-5 md:p-7">
        <div className="mx-auto max-w-5xl space-y-6">

          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">Configurações</h1>
            {isAdmin && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saveSaldos.isPending}
                className="rounded-md bg-dark px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark disabled:opacity-50"
              >
                {saveSaldos.isPending ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            )}
          </div>

          {saveSaldos.isSuccess && (
            <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-positive">
              Configurações salvas com sucesso.
            </p>
          )}

          {/* Status do Sistema */}
          <div className="data-panel p-6 md:p-7">
            <h2 className="mb-6 text-sm font-semibold text-dark">Status do sistema</h2>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between items-center border-b border-grid pb-3">
                <span className="font-bold uppercase text-xs text-muted-foreground">Última sincronização</span>
                <span className="font-black">{status?.last_sync ?? '-'}</span>
              </div>
              <div className="flex justify-between items-center border-b border-grid pb-3">
                <span className="font-bold uppercase text-xs text-muted-foreground">Período dos dados</span>
                <span className="font-black">{status?.de ?? '-'} a {status?.ate ?? '-'}</span>
              </div>
              <div className="flex justify-between items-center border-b border-grid pb-3">
                <span className="font-bold uppercase text-xs text-muted-foreground">Registros AP</span>
                <span className="font-black">{status?.count_ap ?? 0}</span>
              </div>
              <div className="flex justify-between items-center border-b border-grid pb-3">
                <span className="font-bold uppercase text-xs text-muted-foreground">Registros Receitas</span>
                <span className="font-black">{status?.count_receitas ?? 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold uppercase text-xs text-muted-foreground">Registros Saldo</span>
                <span className="font-black">{status?.count_saldo ?? 0}</span>
              </div>
            </div>
          </div>

          {/* Saldo Bancário Manual */}
          <div className="data-panel p-6 md:p-7">
            <h2 className="mb-2 text-sm font-semibold text-dark">Saldo bancário manual</h2>
            <p className="mb-6 text-xs font-medium text-muted-foreground">
              Quando ativado por empresa, o saldo informado substitui o do banco de dados no card
              <strong className="text-dark"> Fluxo de Caixa por Dia</strong>.
              {!isAdmin && <span className="text-muted-foreground"> (somente leitura)</span>}
            </p>

            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-6">
                {EMPRESAS.map((empresa) => {
                  const enabled = isEmpresaEnabled(empresa)
                  const contasPorBanco = filterTree?.contas_por_empresa_banco?.[empresa] ?? {}
                  const bancoCombos = Object.entries(contasPorBanco).flatMap(([banco, contas]) =>
                    (contas as string[]).map((conta) => ({ banco, conta }))
                  )

                  return (
                    <div key={empresa} className="space-y-3 border-b border-grid pb-6 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full border border-white shadow-sm"
                            style={{ backgroundColor: EMPRESA_COLORS[empresa] }}
                          />
                          <span className="text-sm font-semibold text-dark">{empresa}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
                            {enabled ? 'Saldo manual ativo' : 'Usando banco de dados'}
                          </span>
                          <Switch
                            checked={enabled}
                            onCheckedChange={(v) => isAdmin && toggleEmpresa(empresa, v)}
                            disabled={!isAdmin}
                          />
                        </div>
                      </div>

                      {enabled && (
                        <div className="ml-5 overflow-hidden rounded-lg border border-line">
                          {bancoCombos.length === 0 ? (
                              <p className="p-3 text-xs font-medium text-muted-foreground">
                              Nenhuma conta disponível para esta empresa.
                            </p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-line bg-bgBase">
                                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Banco</th>
                                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Conta</th>
                                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Saldo (R$)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {bancoCombos.map(({ banco, conta }) => {
                                  const cfg = getConfig(empresa, banco, conta)
                                  return (
                                    <tr key={`${banco}|${conta}`} className="border-b border-grid last:border-0">
                                      <td className="px-3 py-2 text-muted-foreground font-medium">{banco}</td>
                                      <td className="px-3 py-2 font-medium">{conta}</td>
                                      <td className="px-3 py-2">
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          disabled={!isAdmin}
                                          defaultValue={cfg.saldo !== 0 ? cfg.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}
                                          placeholder="0,00"
                                          onBlur={(e) => {
                                            if (!isAdmin) return
                                            const val = parseBRLInput(e.target.value)
                                            updateSaldo(empresa, banco, conta, val)
                                            e.target.value = val !== 0 ? val.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''
                                          }}
                                          className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-right text-xs font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-60"
                                        />
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t border-line bg-bgBase">
                                  <td colSpan={2} className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em]">Total</td>
                                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                                    {formatCurrency(
                                      bancoCombos.reduce((s, { banco, conta }) => s + getConfig(empresa, banco, conta).saldo, 0)
                                    )}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Sobre */}
          <div className="data-panel p-6 md:p-7">
            <h2 className="mb-4 text-sm font-semibold text-dark">Sobre</h2>
            <p className="text-sm font-medium text-muted-foreground">DashFinance v2.0 · Dashboard financeiro</p>
            <p className="mt-1 text-sm font-medium text-muted-foreground">FastAPI + React + TypeScript</p>
          </div>

        </div>
      </div>
    </div>
  )
}
