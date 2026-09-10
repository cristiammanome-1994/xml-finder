import fs from 'node:fs'
import path from 'node:path'
import type { FileLocation } from '@shared/types'
// Extensão .ts explícita (em vez do padrão dos outros arquivos de engine) porque este módulo
// também é carregado diretamente pelo runner de testes do Node, cujo resolvedor ESM exige o
// especificador exato do arquivo — o bundler de produção (Vite) aceita o mesmo especificador.
import { openZipFromFile, openZipFromBuffer, type OpenZip } from './zipReader.ts'
import { openRarFromBuffer, type OpenRarFile } from './rarReader.ts'
import { MAX_NESTED_ARCHIVE_BYTES, formatMegabytes } from './archiveLimits.ts'

/**
 * Lê o conteúdo de um arquivo (XML ou outro) a partir de uma FileLocation, descendo pelos níveis
 * de compactação.
 *
 * Usado fora do fluxo de busca — "Ver XML" e "Extrair" na UI. Um item pode ter sido encontrado por
 * NOME (sem nunca ter seu conteúdo lido durante a busca em si), então o teto de zip bomb que a
 * busca aplica ao descer em arquivo aninhado (searchEngine.ts) precisa ser reaplicado aqui: sem
 * isso, abrir/extrair um resultado cujo caminho passa por uma entrada com tamanho descomprimido
 * malicioso descompactaria ela inteira em memória sem limite.
 */
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
        if (entry.size > MAX_NESTED_ARCHIVE_BYTES) {
          throw new Error(
            `"${step.entryPath}" tem ${formatMegabytes(entry.size)}, acima do limite de ${formatMegabytes(MAX_NESTED_ARCHIVE_BYTES)} para leitura`
          )
        }
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
      const entryInfo = rar.entries.find((e) => e.fileName === step.entryPath)
      if (!entryInfo) throw new Error(`Entrada não encontrada no RAR: ${step.entryPath}`)
      if (entryInfo.size > MAX_NESTED_ARCHIVE_BYTES) {
        throw new Error(
          `"${step.entryPath}" tem ${formatMegabytes(entryInfo.size)}, acima do limite de ${formatMegabytes(MAX_NESTED_ARCHIVE_BYTES)} para leitura`
        )
      }
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
