import type { LucideIcon } from 'lucide-react'
import { X, Sparkles, Wrench, Bug } from 'lucide-react'
import { useStore } from '../store'
import { CHANGELOG, type ChangelogCategory } from '../changelog'

const CATEGORY_LABEL: Record<ChangelogCategory, string> = {
  novidade: 'Nova funcionalidade',
  melhoria: 'Melhoria',
  correcao: 'Correção'
}

const CATEGORY_ICON: Record<ChangelogCategory, LucideIcon> = {
  novidade: Sparkles,
  melhoria: Wrench,
  correcao: Bug
}

const CATEGORY_COLOR: Record<ChangelogCategory, string> = {
  novidade: 'var(--primary)',
  melhoria: 'var(--status-good)',
  correcao: 'var(--status-warning)'
}

export function UpdatesPanel() {
  const show = useStore((s) => s.showUpdates)
  const setShow = useStore((s) => s.setShowUpdates)

  if (!show) return null

  return (
    <div className="overlay" onClick={() => setShow(false)}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <strong>Atualizações</strong>
          <button className="close-btn" onClick={() => setShow(false)}>
            <X className="icon" />
          </button>
        </div>

        <div className="changelog-list">
          {CHANGELOG.map((entry) => {
            const Icon = CATEGORY_ICON[entry.category]
            const color = CATEGORY_COLOR[entry.category]
            return (
              <div key={entry.version} className="changelog-item">
                <div className="changelog-header">
                  <span
                    className="badge"
                    style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
                  >
                    <Icon className="icon" style={{ width: 12, height: 12 }} />
                    {CATEGORY_LABEL[entry.category]}
                  </span>
                  <span className="changelog-meta">
                    <span className="mono">v{entry.version}</span>
                    <span>{new Date(entry.date + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                  </span>
                </div>
                <div className="changelog-title">{entry.title}</div>
                <div className="changelog-desc">{entry.description}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
