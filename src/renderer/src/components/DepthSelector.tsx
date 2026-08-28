import { useStore } from '../store'
import type { ArchiveDepthOption } from '@shared/types'

const OPTIONS: { value: ArchiveDepthOption; label: string }[] = [
  { value: 1, label: '1 nível' },
  { value: 2, label: '2 níveis' },
  { value: 3, label: '3 níveis (padrão)' },
  { value: 5, label: '5 níveis' },
  { value: 'unlimited', label: 'Ilimitado' }
]

export function DepthSelector() {
  const maxDepth = useStore((s) => s.maxDepth)
  const setMaxDepth = useStore((s) => s.setMaxDepth)
  const searching = useStore((s) => s.searching)

  return (
    <div className="card">
      <span className="section-label">Profundidade máxima de arquivos compactados</span>
      <select
        value={String(maxDepth)}
        disabled={searching}
        onChange={(e) => {
          const v = e.target.value
          setMaxDepth(v === 'unlimited' ? 'unlimited' : (Number(v) as ArchiveDepthOption))
        }}
      >
        {OPTIONS.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
