import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ChainStep, DocumentType, StorageType } from '@shared/types'

/**
 * Cache local (SQLite) de "chave de acesso -> onde foi encontrada da última vez", por pasta raiz.
 * Não é um índice completo da base (não lê todo XML antecipadamente): é populado
 * oportunisticamente por cada busca bem-sucedida, e consultado no início da próxima busca na
 * mesma pasta antes de varrer o disco. Buscas repetidas por uma mesma chave numa base grande
 * ficam quase instantâneas em vez de refazer o scan inteiro toda vez.
 *
 * Invalidação: cada entrada guarda o mtime do arquivo/contêiner (pasta solta, ZIP ou RAR) no
 * momento em que foi encontrada. Na consulta, comparamos com o mtime atual — se mudou (ou o
 * arquivo sumiu), a entrada é ignorada e a chave cai de volta para a varredura normal.
 */

export interface CachedFind {
  diskPath: string
  chain: ChainStep[]
  fileName: string
  sizeBytes: number
  docType: DocumentType
  storageType: StorageType
  containerMtimeMs: number
}

export interface SearchIndex {
  lookup: (rootFolder: string, accessKey: string) => CachedFind | null
  remember: (rootFolder: string, accessKey: string, entry: CachedFind) => void
  close: () => void
}

function indexDbPath(userDataDir: string): string {
  return path.join(userDataDir, 'xml-finder-index.db')
}

/** Abre (ou cria) o índice. Retorna null se o SQLite não puder ser usado — o cache é só uma
 * otimização, nunca deve impedir a busca de funcionar. */
export function openSearchIndex(userDataDir: string): SearchIndex | null {
  try {
    const db = new DatabaseSync(indexDbPath(userDataDir))
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS indexed_key (
        root_folder TEXT NOT NULL,
        access_key TEXT NOT NULL,
        disk_path TEXT NOT NULL,
        chain_json TEXT NOT NULL,
        file_name TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        doc_type TEXT NOT NULL,
        storage_type TEXT NOT NULL,
        container_mtime_ms REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (root_folder, access_key)
      )
    `)

    const selectStmt = db.prepare('SELECT * FROM indexed_key WHERE root_folder = ? AND access_key = ?')
    const upsertStmt = db.prepare(`
      INSERT INTO indexed_key
        (root_folder, access_key, disk_path, chain_json, file_name, size_bytes, doc_type, storage_type, container_mtime_ms, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_folder, access_key) DO UPDATE SET
        disk_path = excluded.disk_path,
        chain_json = excluded.chain_json,
        file_name = excluded.file_name,
        size_bytes = excluded.size_bytes,
        doc_type = excluded.doc_type,
        storage_type = excluded.storage_type,
        container_mtime_ms = excluded.container_mtime_ms,
        updated_at = excluded.updated_at
    `)

    return {
      lookup(rootFolder, accessKey) {
        try {
          const row = selectStmt.get(rootFolder, accessKey) as Record<string, unknown> | undefined
          if (!row) return null
          return {
            diskPath: String(row.disk_path),
            chain: JSON.parse(String(row.chain_json)) as ChainStep[],
            fileName: String(row.file_name),
            sizeBytes: Number(row.size_bytes),
            docType: row.doc_type as DocumentType,
            storageType: row.storage_type as StorageType,
            containerMtimeMs: Number(row.container_mtime_ms)
          }
        } catch {
          return null
        }
      },
      remember(rootFolder, accessKey, entry) {
        try {
          upsertStmt.run(
            rootFolder,
            accessKey,
            entry.diskPath,
            JSON.stringify(entry.chain),
            entry.fileName,
            entry.sizeBytes,
            entry.docType,
            entry.storageType,
            entry.containerMtimeMs,
            Date.now()
          )
        } catch {
          // cache é best-effort — uma falha ao gravar não deve afetar a busca em andamento
        }
      },
      close() {
        try {
          db.close()
        } catch {
          // ignore
        }
      }
    }
  } catch {
    return null
  }
}

export async function clearSearchIndex(userDataDir: string): Promise<void> {
  const fs = await import('node:fs')
  try {
    await fs.promises.rm(indexDbPath(userDataDir))
    await fs.promises.rm(indexDbPath(userDataDir) + '-wal', { force: true })
    await fs.promises.rm(indexDbPath(userDataDir) + '-shm', { force: true })
  } catch {
    // arquivo pode não existir ainda
  }
}
