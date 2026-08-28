import { useStore } from '../store'

function fmtElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function ProgressPanel() {
  const searching = useStore((s) => s.searching)
  const stats = useStore((s) => s.stats)

  if (!searching) return null

  const pct =
    stats.estimatedTotal > 0 ? Math.min(100, Math.round((stats.foundCount / stats.estimatedTotal) * 100)) : 0

  return (
    <div className="card progress-card">
      <div className="progress-headline">
        <span>Pesquisando...</span>
        <span className="pct">{pct}%</span>
      </div>
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-stats-grid">
        <div className="stat">
          <span>Arquivos analisados</span>
          <b>{stats.filesScanned.toLocaleString('pt-BR')}</b>
        </div>
        <div className="stat">
          <span>XMLs analisados</span>
          <b>{stats.xmlAnalyzed.toLocaleString('pt-BR')}</b>
        </div>
        <div className="stat">
          <span>Arquivos ZIP</span>
          <b>{stats.zipCount.toLocaleString('pt-BR')}</b>
        </div>
        <div className="stat">
          <span>Arquivos RAR</span>
          <b>{stats.rarCount.toLocaleString('pt-BR')}</b>
        </div>
        <div className="stat">
          <span>XMLs encontrados</span>
          <b>{stats.foundCount.toLocaleString('pt-BR')}</b>
        </div>
        <div className="stat">
          <span>Tempo decorrido</span>
          <b>{fmtElapsed(stats.elapsedMs)}</b>
        </div>
      </div>
    </div>
  )
}
