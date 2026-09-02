import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useStore, emptyStats } from '../store'
import { fmtElapsed } from '../format'
import { useEscapeKey } from '../useEscapeKey'
import type { HistoryEntry } from '@shared/types'

export function HistoryPanel() {
  const show = useStore((s) => s.showHistory)
  const setShow = useStore((s) => s.setShowHistory)
  const loadFromHistory = useStore((s) => s.loadFromHistory)
  const showToast = useStore((s) => s.showToast)
  const [entries, setEntries] = useState<HistoryEntry[]>([])

  const close = useCallback(() => setShow(false), [setShow])
  useEscapeKey(show, close)

  useEffect(() => {
    if (show) window.api.listHistory().then(setEntries)
  }, [show])

  if (!show) return null

  async function handleClear(): Promise<void> {
    await window.api.clearHistory()
    setEntries([])
  }

  async function handleClearIndex(): Promise<void> {
    await window.api.clearSearchIndex()
    showToast('Índice de pesquisa limpo')
  }

  function reopen(entry: HistoryEntry): void {
    loadFromHistory(
      entry.results,
      {
        ...emptyStats,
        foundCount: entry.found,
        notFoundCount: entry.notFound,
        elapsedMs: entry.elapsedMs,
        estimatedTotal: entry.totalIdentifiers,
        phase: entry.cancelled ? 'cancelado' : 'concluido'
      },
      entry.rootFolder
    )
  }

  return (
    <div className="overlay" onClick={() => setShow(false)}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Histórico de pesquisas"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-header">
          <strong>Histórico de pesquisas</strong>
          <button className="close-btn" onClick={() => setShow(false)} aria-label="Fechar histórico">
            <X className="icon" />
          </button>
        </div>

        {entries.length === 0 ? (
          <div style={{ color: 'var(--muted-foreground)', fontSize: 12.5 }}>Nenhuma pesquisa salva ainda.</div>
        ) : (
          <>
            <div className="history-list">
              {entries.map((e) => (
                <div
                  key={e.id}
                  className="history-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => reopen(e)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      reopen(e)
                    }
                  }}
                >
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

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--muted-foreground)', fontSize: 12.5, marginBottom: 8 }}>
            O XML Finder guarda um índice local por pasta pesquisada, para achar chaves já vistas
            antes quase instantaneamente. Se a pasta mudou muito (arquivos movidos/renomeados em massa),
            limpar o índice força a próxima pesquisa a varrer tudo de novo do zero.
          </div>
          <button className="btn block" onClick={handleClearIndex}>
            Limpar índice de pesquisa
          </button>
        </div>
      </div>
    </div>
  )
}
