import { FileSearch, History, ShieldCheck } from 'lucide-react'
import { useStore } from '../store'
import { ThemeToggle } from './ThemeToggle'

export function Header() {
  const showHistory = useStore((s) => s.showHistory)
  const setShowHistory = useStore((s) => s.setShowHistory)

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
        <button className="btn ghost sm" onClick={() => setShowHistory(!showHistory)}>
          <History className="icon" style={{ width: 13, height: 13 }} />
          Histórico
        </button>
        <ThemeToggle />
      </div>
    </header>
  )
}
