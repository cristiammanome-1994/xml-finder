import { FileSearch, History, ShieldCheck, Bell } from 'lucide-react'
import { useStore } from '../store'
import { LATEST_VERSION } from '../changelog'
import { ThemeToggle } from './ThemeToggle'

export function Header() {
  const showHistory = useStore((s) => s.showHistory)
  const setShowHistory = useStore((s) => s.setShowHistory)
  const showUpdates = useStore((s) => s.showUpdates)
  const setShowUpdates = useStore((s) => s.setShowUpdates)
  const seenVersion = useStore((s) => s.seenVersion)
  const searching = useStore((s) => s.searching)
  const hasUnseenUpdates = seenVersion !== LATEST_VERSION

  return (
    <header className="header">
      <div className="header-title">
        <span className="header-mark">
          <FileSearch className="icon" />
        </span>
        <div>
          <h1>XML Finder</h1>
          <div className="subtitle">Pastas, ZIPs e RARs</div>
        </div>
      </div>
      <div className="header-actions">
        <span
          className="privacy-note"
          title="Seus arquivos são processados localmente e não são enviados para a nuvem."
        >
          <ShieldCheck className="icon" style={{ width: 13, height: 13 }} />
          100% local
        </span>
        <button
          className="btn ghost sm"
          onClick={() => setShowHistory(!showHistory)}
          disabled={searching}
          title={searching ? 'Aguarde a pesquisa atual terminar ou cancele antes de abrir o histórico' : undefined}
        >
          <History className="icon" style={{ width: 13, height: 13 }} />
          Histórico
        </button>
        <span className="header-btn-wrap">
          <button className="btn ghost sm" onClick={() => setShowUpdates(!showUpdates)}>
            <Bell className="icon" style={{ width: 13, height: 13 }} />
            Atualizações
          </button>
          {hasUnseenUpdates && <span className="unread-dot" />}
        </span>
        <ThemeToggle />
      </div>
    </header>
  )
}
