import type { Periodo } from '@/types'

const MESES_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const currentYear = new Date().getFullYear()
const ANOS = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2]

interface Props {
  periodo: Periodo
  onChange: (p: Periodo) => void
}

function clampFim(
  inicio: { ano: number; mes: number },
  fim: { ano: number; mes: number },
): { ano: number; mes: number } {
  if (fim.ano < inicio.ano || (fim.ano === inicio.ano && fim.mes < inicio.mes)) {
    return { ...inicio }
  }
  const span = (fim.ano - inicio.ano) * 12 + (fim.mes - inicio.mes) + 1
  if (span > 24) {
    let total = inicio.ano * 12 + (inicio.mes - 1) + 23
    return { ano: Math.floor(total / 12), mes: (total % 12) + 1 }
  }
  return fim
}

export function PeriodoMesesSelector({ periodo, onChange }: Props) {
  const sel = "text-xs font-bold uppercase tracking-widest border-2 border-dark px-3 py-2 bg-white focus:outline-none focus:border-brand"
  const lbl = "text-xs font-bold uppercase tracking-widest text-dark/60"

  function handleInicioMes(mes: number) {
    const fim = clampFim({ ano: periodo.anoInicio, mes }, { ano: periodo.anoFim, mes: periodo.mesFim })
    onChange({ ...periodo, mesInicio: mes, anoFim: fim.ano, mesFim: fim.mes })
  }

  function handleInicioAno(anoInicio: number) {
    const fim = clampFim({ ano: anoInicio, mes: periodo.mesInicio }, { ano: periodo.anoFim, mes: periodo.mesFim })
    onChange({ ...periodo, anoInicio, anoFim: fim.ano, mesFim: fim.mes })
  }

  function handleFimMes(mes: number) {
    const fim = clampFim({ ano: periodo.anoInicio, mes: periodo.mesInicio }, { ano: periodo.anoFim, mes })
    onChange({ ...periodo, anoFim: fim.ano, mesFim: fim.mes })
  }

  function handleFimAno(anoFim: number) {
    const fim = clampFim({ ano: periodo.anoInicio, mes: periodo.mesInicio }, { ano: anoFim, mes: periodo.mesFim })
    onChange({ ...periodo, anoFim: fim.ano, mesFim: fim.mes })
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={lbl}>De</span>
      <select className={sel} value={periodo.mesInicio} onChange={(e) => handleInicioMes(Number(e.target.value))}>
        {MESES_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
      <select className={sel} value={periodo.anoInicio} onChange={(e) => handleInicioAno(Number(e.target.value))}>
        {ANOS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <span className={lbl}>até</span>
      <select className={sel} value={periodo.mesFim} onChange={(e) => handleFimMes(Number(e.target.value))}>
        {MESES_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
      <select className={sel} value={periodo.anoFim} onChange={(e) => handleFimAno(Number(e.target.value))}>
        {ANOS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}
