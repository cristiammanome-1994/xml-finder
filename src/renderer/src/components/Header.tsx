import { useStore } from '../store'

export function Header() {
  const showHistory = useStore((s) => s.showHistory)
  const setShowHistory = useStore((s) => s.setShowHistory)

  return (
    <header className="header">
      <div className="header-title">
        <h1>XML Finder</h1>
        <span className="subtitle">Localize XMLs em pastas, subpastas, ZIPs e RARs.</span>
      </div>
      <div className="header-actions">
        <span className="privacy-note" title="Seus arquivos são processados localmente e não são enviados para a nuvem.">
          🔒 Processamento 100% local
        </span>
        <button className="btn ghost sm" onClick={() => setShowHistory(!showHistory)}>
          🕘 Histórico
        </button>
      </div>
    </header>
  )
}
