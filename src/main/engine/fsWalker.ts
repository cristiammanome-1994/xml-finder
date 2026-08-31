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
 * Quantas chamadas fs.stat ficam em voo ao mesmo tempo por diretório. Em disco local o ganho é
 * pequeno, mas em pasta de rede (SMB/NFS) — comum para bases fiscais compartilhadas — cada stat
 * sequencial paga a latência de rede inteira; com N em voo, essa latência é amortizada entre elas.
 */
const STAT_CONCURRENCY = 16

interface StatOutcome {
  full: string
  stat: fs.Stats | null
  error: Error | null
}

function statOne(full: string): Promise<StatOutcome> {
  return fs.promises.stat(full).then(
    (stat) => ({ full, stat, error: null }),
    (err) => ({ full, stat: null, error: err as Error })
  )
}

/**
 * Percorre recursivamente uma pasta, produzindo cada arquivo encontrado.
 * Usa fs.opendir para manter uso de memória limitado à profundidade da árvore (mais uma janela
 * fixa de STAT_CONCURRENCY stats em voo), não ao número total de arquivos.
 * Não segue links simbólicos (evita ciclos).
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
  const inFlight: Promise<StatOutcome>[] = []

  function emit(outcome: StatOutcome): WalkedFile | null {
    if (outcome.error) {
      onError({ path: outcome.full, message: outcome.error.message })
      return null
    }
    return { absPath: outcome.full, size: outcome.stat!.size, mtimeMs: outcome.stat!.mtimeMs }
  }

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

      inFlight.push(statOne(full))
      if (inFlight.length >= STAT_CONCURRENCY) {
        const result = emit(await inFlight.shift()!)
        if (result) yield result
      }
    }
  } catch (err) {
    onError({ path: dirPath, message: (err as Error).message })
  }

  for (const pending of inFlight) {
    const result = emit(await pending)
    if (result) yield result
  }

  for (const sub of subDirs) {
    if (isCancelled()) break
    yield* walkDir(sub, onError, isCancelled)
  }
}
