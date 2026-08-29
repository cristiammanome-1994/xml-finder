import { useStore } from '../store'
import { fmtElapsed } from '../format'

export function ProgressPanel() {
  const searching = useStore((s) => s.searching)
  const stats = useStore((s) => s.stats)

  if (!searching) return null

  // Não dá para saber quantos arquivos existem sem varrer a pasta inteira antes, então a barra
  // mostra o que é conhecido e útil: quantos dos XMLs pedidos já foram localizados. O rótulo diz
  // isso explicitamente para não ser lido como "% da pasta varrida".
  const pct =
    stats.estimatedTotal > 0 ? Math.min(100, Math.round((stats.foundCount / stats.estimatedTotal) * 100)) : 0

  return (
    <div className="card progress-card">
      <div className="progress-headline">
        <span>Pesquisando...</span>
        <span className="pct">
          {stats.foundCount.toLocaleString('pt-BR')} de {stats.estimatedTotal.toLocaleString('pt-BR')} localizados
        </span>
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
