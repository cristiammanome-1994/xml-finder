import { Search, X } from 'lucide-react'
import { useStore } from '../store'
import { parseIdentifierList } from '@shared/keyUtils'

export function SearchLauncher() {
  const rootFolder = useStore((s) => s.rootFolder)
  const identifiersRaw = useStore((s) => s.identifiersRaw)
  const maxDepth = useStore((s) => s.maxDepth)
  const searching = useStore((s) => s.searching)
  const resetForNewSearch = useStore((s) => s.resetForNewSearch)
  const beginSearch = useStore((s) => s.beginSearch)

  const identifiers = parseIdentifierList(identifiersRaw)
  const canSearch = !!rootFolder && identifiers.length > 0 && !searching

  async function handleStart(): Promise<void> {
    if (!rootFolder) return
    resetForNewSearch()
    beginSearch()
    await window.api.startSearch({ rootFolder, identifiers, maxDepth })
  }

  async function handleCancel(): Promise<void> {
    await window.api.cancelSearch()
  }

  if (searching) {
    return (
      <button className="btn danger block" onClick={handleCancel}>
        <X className="icon" />
        Cancelar pesquisa
      </button>
    )
  }

  return (
    <button className="btn primary block" onClick={handleStart} disabled={!canSearch}>
      <Search className="icon" />
      LOCALIZAR XMLs
    </button>
  )
}
