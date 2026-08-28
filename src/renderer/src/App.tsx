import { useEffect, useRef } from 'react'
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
import { Toast } from './components/Toast'

export default function App() {
  const applyProgress = useStore((s) => s.applyProgress)
  const applyFound = useStore((s) => s.applyFound)
  const applyError = useStore((s) => s.applyError)
  const applyDone = useStore((s) => s.applyDone)
  const rootFolder = useStore((s) => s.rootFolder)

  const foundRef = useRef(useStore.getState().found)
  useEffect(() => useStore.subscribe((s) => (foundRef.current = s.found)), [])

  useEffect(() => {
    const unsubscribe = window.api.onSearchMessage((msg) => {
      if (msg.type === 'progress') applyProgress(msg.stats)
      else if (msg.type === 'found') applyFound(msg.item)
      else if (msg.type === 'scan_error') applyError(msg.error)
      else if (msg.type === 'done') {
        applyDone(msg.stats, msg.notFound, msg.limitationNotes)
        const totalIdentifiers = foundRef.current.length + msg.notFound.length
        if (rootFolder && totalIdentifiers > 0) {
          void window.api.appendHistory({
            rootFolder,
            totalIdentifiers,
            found: foundRef.current.length,
            notFound: msg.notFound.length,
            elapsedMs: msg.stats.elapsedMs,
            results: [...foundRef.current, ...msg.notFound]
          })
        }
      }
    })
    return unsubscribe
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
      <Toast />
    </div>
  )
}
