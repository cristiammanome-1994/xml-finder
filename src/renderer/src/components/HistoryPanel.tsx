import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'
import type { HistoryEntry } from '@shared/types'

function fmtElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function HistoryPanel() {
  const show = useStore((s) => s.showHistory)
  const setShow = useStore((s) => s.setShowHistory)
  const loadFromHistory = useStore((s) => s.loadFromHistory)
  const [entries, setEntries] = useState<HistoryEntry[]>([])

  useEffect(() => {
    if (show) window.api.listHistory().then(setEntries)
  }, [show])

  if (!show) return null

  async function handleClear(): Promise<void> {
    await window.api.clearHistory()
    setEntries([])
  }

  function reopen(entry: HistoryEntry): void {
    const stats = {
      filesScanned: 0,
      xmlAnalyzed: 0,
      zipCount: 0,
      rarCount: 0,
      foundCount: entry.found,
      notFoundCount: entry.notFound,
      errorCount: 0,
      elapsedMs: entry.elapsedMs,
      estimatedTotal: entry.totalIdentifiers,
      phase: entry.cancelled ? ('cancelado' as const) : ('concluido' as const)
    }
    loadFromHistory(entry.results, stats, entry.rootFolder)
  }

  return (
    <div className="overlay" onClick={() => setShow(false)}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <strong>Histórico de pesquisas</strong>
          <button className="close-btn" onClick={() => setShow(false)}>
            <X className="icon" />
          </button>
        </div>

        {entries.length === 0 ? (
          <div style={{ color: 'var(--muted-foreground)', fontSize: 12.5 }}>Nenhuma pesquisa salva ainda.</div>
        ) : (
          <>
            <div className="history-list">
              {entries.map((e) => (
                <div key={e.id} className="history-item" onClick={() => reopen(e)}>
                  <div className="date">
                    {new Date(e.date).toLocaleString('pt-BR')}
                    {e.cancelled && (
                      <span className="badge type" style={{ marginLeft: 8, color: 'var(--status-warning)' }}>
                        Cancelada — incompleta
                      </span>
                    )}
                  </div>
                  <div className="path">{e.rootFolder}</div>
                  <div className="stats">
                    <span>{e.totalIdentifiers} pesquisados</span>
                    <span style={{ color: 'var(--status-good)' }}>{e.found} encontrados</span>
                    <span style={{ color: 'var(--status-critical)' }}>{e.notFound} não encontrados</span>
                    <span>{fmtElapsed(e.elapsedMs)}</span>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn danger block" style={{ marginTop: 16 }} onClick={handleClear}>
              Limpar histórico
            </button>
          </>
        )}
      </div>
    </div>
  )
}
