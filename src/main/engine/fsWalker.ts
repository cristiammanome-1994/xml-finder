import fs from 'node:fs'
import path from 'node:path'

export interface WalkedFile {
  absPath: string
  size: number
  mtimeMs: number
}

export interface WalkError {
  path: string
  message: string
}

/**
 * Percorre recursivamente uma pasta, produzindo cada arquivo encontrado.
 * Usa fs.opendir para manter uso de memória limitado à profundidade da árvore,
 * não ao número total de arquivos. Não segue links simbólicos (evita ciclos).
 */
export async function* walkFolder(
  root: string,
  onError: (e: WalkError) => void,
  isCancelled: () => boolean
): AsyncGenerator<WalkedFile> {
  yield* walkDir(root, onError, isCancelled)
}

async function* walkDir(
  dirPath: string,
  onError: (e: WalkError) => void,
  isCancelled: () => boolean
): AsyncGenerator<WalkedFile> {
  if (isCancelled()) return

  let dir: fs.Dir
  try {
    dir = await fs.promises.opendir(dirPath)
  } catch (err) {
    onError({ path: dirPath, message: (err as Error).message })
    return
  }

  const subDirs: string[] = []

  try {
    for await (const dirent of dir) {
      if (isCancelled()) break
      const full = path.join(dirPath, dirent.name)

      if (dirent.isSymbolicLink()) continue

      if (dirent.isDirectory()) {
        subDirs.push(full)
        continue
      }

      if (!dirent.isFile()) continue

      try {
        const stat = await fs.promises.stat(full)
        yield { absPath: full, size: stat.size, mtimeMs: stat.mtimeMs }
      } catch (err) {
        onError({ path: full, message: (err as Error).message })
      }
    }
  } catch (err) {
    onError({ path: dirPath, message: (err as Error).message })
  }

  for (const sub of subDirs) {
    if (isCancelled()) break
    yield* walkDir(sub, onError, isCancelled)
  }
}
