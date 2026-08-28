import { useMemo } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ListChecks,
  CheckCircle2,
  XCircle,
  FileArchive,
  PackageOpen,
  Folder,
  AlertTriangle,
  OctagonAlert
} from 'lucide-react'
import { useStore } from '../store'

function StatCard({
  label,
  value,
  icon: Icon,
  tone
}: {
  label: string
  value: number
  icon: LucideIcon
  tone?: 'good' | 'critical' | 'warning'
}) {
  const color =
    tone === 'good'
      ? 'var(--status-good)'
      : tone === 'critical'
        ? 'var(--status-critical)'
        : tone === 'warning'
          ? 'var(--status-warning)'
          : 'var(--primary)'

  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}>
        <Icon />
      </div>
      <div className="stat-body">
        <div className="stat-value" style={{ color: tone ? color : undefined }}>
          {value.toLocaleString('pt-BR')}
        </div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
}

export function SummaryStats() {
  const found = useStore((s) => s.found)
  const notFound = useStore((s) => s.notFound)
  const errors = useStore((s) => s.errors)
  const hasSearched = useStore((s) => s.hasSearched)
  const phase = useStore((s) => s.stats.phase)

  const breakdown = useMemo(() => {
    let zip = 0
    let rar = 0
    let folder = 0
    for (const f of found) {
      if (f.storageType === 'ZIP') zip++
      else if (f.storageType === 'RAR') rar++
      else folder++
    }
    return { zip, rar, folder }
  }, [found])

  if (!hasSearched) return null

  const total = found.length + notFound.length

  return (
    <>
      {phase === 'cancelado' && (
        <div className="errors-banner" style={{ cursor: 'default', marginTop: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <OctagonAlert className="icon" style={{ width: 13, height: 13 }} />
            Esta pesquisa foi cancelada antes de terminar — os "não encontrados" abaixo podem só não ter sido
            verificados ainda, não significam que o XML não existe.
          </span>
        </div>
      )}
      <div className="summary-bar">
        <StatCard label="Pesquisados" value={total} icon={ListChecks} />
        <StatCard label="Encontrados" value={found.length} icon={CheckCircle2} tone="good" />
        <StatCard label="Não encontrados" value={notFound.length} icon={XCircle} tone="critical" />
        <StatCard label="Dentro de ZIP" value={breakdown.zip} icon={FileArchive} />
        <StatCard label="Dentro de RAR" value={breakdown.rar} icon={PackageOpen} />
        <StatCard label="Em pastas" value={breakdown.folder} icon={Folder} />
        {errors.length > 0 && <StatCard label="Erros" value={errors.length} icon={AlertTriangle} tone="warning" />}
      </div>
    </>
  )
}
