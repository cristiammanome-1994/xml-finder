import fs from 'node:fs'
import path from 'node:path'
import type { HistoryEntry } from '@shared/types'

const MAX_HISTORY_ENTRIES = 50
// Cada entrada embute o resultado completo da pesquisa (todo FoundItem/NotFoundItem), então
// limitar só a quantidade de entradas não limita o tamanho do arquivo — uma pesquisa com dezenas
// de milhares de itens já estoura isso sozinha. Por isso também cortamos por tamanho serializado.
const MAX_HISTORY_BYTES = 15 * 1024 * 1024

function historyFilePath(userDataDir: string): string {
  return path.join(userDataDir, 'xml-finder-history.json')
}

export async function loadHistory(userDataDir: string): Promise<HistoryEntry[]> {
  try {
    const raw = await fs.promises.readFile(historyFilePath(userDataDir), 'utf8')
    const parsed = JSON.parse(raw) as HistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function appendHistoryEntry(userDataDir: string, entry: HistoryEntry): Promise<HistoryEntry[]> {
  const current = await loadHistory(userDataDir)
  let next = [entry, ...current].slice(0, MAX_HISTORY_ENTRIES)

  let serialized = JSON.stringify(next)
  // Descarta as pesquisas mais antigas até caber no orçamento de tamanho — a mais recente
  // (a que acabou de ser adicionada) nunca é removida, mesmo que sozinha já ultrapasse o limite.
  while (serialized.length > MAX_HISTORY_BYTES && next.length > 1) {
    next = next.slice(0, -1)
    serialized = JSON.stringify(next)
  }

  await fs.promises.writeFile(historyFilePath(userDataDir), serialized, 'utf8')
  return next
}

export async function clearHistory(userDataDir: string): Promise<void> {
  try {
    await fs.promises.rm(historyFilePath(userDataDir))
  } catch {
    // arquivo pode não existir ainda
  }
}
