import fs from 'node:fs'
import path from 'node:path'
import type { HistoryEntry } from '@shared/types'

const MAX_HISTORY_ENTRIES = 50

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
  const next = [entry, ...current].slice(0, MAX_HISTORY_ENTRIES)
  await fs.promises.writeFile(historyFilePath(userDataDir), JSON.stringify(next), 'utf8')
  return next
}

export async function clearHistory(userDataDir: string): Promise<void> {
  try {
    await fs.promises.rm(historyFilePath(userDataDir))
  } catch {
    // arquivo pode não existir ainda
  }
}
