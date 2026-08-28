import { useStore } from '../store'

export function FolderSelector() {
  const rootFolder = useStore((s) => s.rootFolder)
  const setRootFolder = useStore((s) => s.setRootFolder)
  const searching = useStore((s) => s.searching)

  async function pick(): Promise<void> {
    const folder = await window.api.selectFolder()
    if (folder) setRootFolder(folder)
  }

  return (
    <div className="card">
      <span className="section-label">Pasta para pesquisa</span>
      <div className={`folder-path ${rootFolder ? '' : 'empty'}`}>
        {rootFolder ?? 'Nenhuma pasta selecionada'}
      </div>
      <div style={{ marginTop: 10 }}>
        <button className="btn block" onClick={pick} disabled={searching}>
          📁 Selecionar pasta
        </button>
      </div>
    </div>
  )
}
