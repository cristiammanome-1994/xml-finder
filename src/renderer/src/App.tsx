import { useEffect, useRef } from 'react'
import type { FoundItem } from '@shared/types'
import { useStore } from './store'
import { Header } from './components/Header'
import { FolderSelector } from './components/FolderSelector'
import { IdentifiersInput } from './components/IdentifiersInput'
import { DepthSelector } from './components/DepthSelector'
import { SearchLauncher } from './components/SearchLauncher'
import { ProgressPanel } from './components/ProgressPanel'
import { SummaryStats } from './components/SummaryStats'
import { ErrorsPanel } from './components/ErrorsPanel'
import { ResultsTable } from './components/ResultsTable'
import { ResultDetailDrawer } from './components/ResultDetailDrawer'
import { HistoryPanel } from './components/HistoryPanel'
import { UpdatesPanel } from './components/UpdatesPanel'
import { Toast } from './components/Toast'

/**
 * Os resultados chegam do worker um a um, mas são aplicados ao estado em lotes: uma pesquisa que
 * localiza milhares de XMLs geraria milhares de atualizações de estado e re-renders da tabela,
 * cada um copiando o array inteiro. Este intervalo casa com o throttle de progresso do worker.
 */
const FOUND_FLUSH_MS = 150

export default function App() {
  const applyProgress = useStore((s) => s.applyProgress)
  const applyFoundBatch = useStore((s) => s.applyFoundBatch)
  const applyError = useStore((s) => s.applyError)
  const applyDone = useStore((s) => s.applyDone)
  const rootFolder = useStore((s) => s.rootFolder)

  const foundRef = useRef(useStore.getState().found)
  useEffect(() => useStore.subscribe((s) => (foundRef.current = s.found)), [])

  useEffect(() => {
    const buffer: FoundItem[] = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = (): void => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (buffer.length === 0) return
      applyFoundBatch(buffer.splice(0, buffer.length))
    }

    const unsubscribe = window.api.onSearchMessage((msg) => {
      if (msg.type === 'progress') applyProgress(msg.stats)
      else if (msg.type === 'found') {
        buffer.push(msg.item)
        if (!flushTimer) flushTimer = setTimeout(flush, FOUND_FLUSH_MS)
      } else if (msg.type === 'scan_error') applyError(msg.error)
      else if (msg.type === 'done') {
        // Esvazia o buffer ANTES de finalizar: o histórico é montado a partir do que está no
        // estado, então um resultado ainda em buffer sumiria da pesquisa salva.
        flush()
        applyDone(msg.stats, msg.notFound, msg.limitationNotes)
        const totalIdentifiers = foundRef.current.length + msg.notFound.length
        if (rootFolder && totalIdentifiers > 0) {
          void window.api.appendHistory({
            rootFolder,
            totalIdentifiers,
            found: foundRef.current.length,
            notFound: msg.notFound.length,
            elapsedMs: msg.stats.elapsedMs,
            results: [...foundRef.current, ...msg.notFound],
            cancelled: msg.stats.phase === 'cancelado'
          })
        }
      }
    })
    return () => {
      // Garante que nada fique preso no buffer se o componente for desmontado no meio.
      flush()
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootFolder])

  return (
    <div className="app">
      <Header />
      <div className="main">
        <aside className="sidebar">
          <FolderSelector />
          <IdentifiersInput />
          <DepthSelector />
          <SearchLauncher />
          <ProgressPanel />
        </aside>
        <section className="content">
          <SummaryStats />
          <ErrorsPanel />
          <ResultsTable />
        </section>
      </div>
      <ResultDetailDrawer />
      <HistoryPanel />
      <UpdatesPanel />
      <Toast />
    </div>
  )
}
