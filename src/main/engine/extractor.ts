import fs from 'node:fs'
import path from 'node:path'
import type { FileLocation } from '@shared/types'
import { openZipFromFile, openZipFromBuffer, type OpenZip } from './zipReader'
import { openRarFromBuffer, type OpenRarFile } from './rarReader'

/** Lê o conteúdo de um arquivo (XML ou outro) a partir de uma FileLocation, descendo pelos níveis de compactação. */
export async function readLocationContent(location: FileLocation): Promise<Buffer> {
  if (location.chain.length === 0) {
    return fs.promises.readFile(location.diskPath)
  }

  let currentBuffer: Buffer | null = null
  let currentDiskPath = location.diskPath

  for (let i = 0; i < location.chain.length; i++) {
    const step = location.chain[i]
    const isLast = i === location.chain.length - 1

    if (step.containerType === 'zip') {
      const zip: OpenZip = currentBuffer
        ? await openZipFromBuffer(currentBuffer)
        : await openZipFromFile(currentDiskPath)
      try {
        const entry = zip.entries.find((e) => e.fileName === step.entryPath)
        if (!entry) throw new Error(`Entrada não encontrada no ZIP: ${step.entryPath}`)
        const content = await zip.readEntryFull(entry)
        if (isLast) return content
        currentBuffer = content
      } finally {
        zip.close()
      }
    } else {
      const rar: OpenRarFile = currentBuffer
        ? await openRarFromBuffer(currentBuffer)
        : await openRarFromBuffer(await fs.promises.readFile(currentDiskPath))
      const extracted: Map<string, Buffer> = await rar.readEntries([step.entryPath])
      const content: Buffer | undefined = extracted.get(step.entryPath)
      if (!content) throw new Error(`Entrada não encontrada no RAR: ${step.entryPath}`)
      if (isLast) return content
      currentBuffer = content
    }
  }

  throw new Error('Não foi possível ler o conteúdo do arquivo')
}

/** Extrai (grava em disco) somente o arquivo apontado por location, sem descompactar o arquivo inteiro. */
export async function extractSingleFile(
  location: FileLocation,
  fileName: string,
  destinationFolder: string
): Promise<string> {
  const content = await readLocationContent(location)
  await fs.promises.mkdir(destinationFolder, { recursive: true })

  // Sempre reduz a apenas o nome do arquivo, descartando qualquer componente de caminho —
  // barreira explícita contra zip-slip/path traversal, em vez de depender de fileName já
  // vir "limpo" de quem chamou.
  const safeName = path.basename(fileName)
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error(`Nome de arquivo inválido para extração: ${fileName}`)
  }

  let destPath = path.join(destinationFolder, safeName)
  let counter = 1
  while (await pathExists(destPath)) {
    const ext = path.extname(safeName)
    const base = path.basename(safeName, ext)
    destPath = path.join(destinationFolder, `${base} (${counter})${ext}`)
    counter++
  }

  await fs.promises.writeFile(destPath, content)
  return destPath
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p)
    return true
  } catch {
    return false
  }
}
