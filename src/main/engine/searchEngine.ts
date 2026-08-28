import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ArchiveDepthOption,
  ChainStep,
  DocumentType,
  FileLocation,
  FoundItem,
  MatchMethod,
  NotFoundItem,
  ScanError,
  SearchOptions,
  SearchStats,
  StorageType
} from '@shared/types'
import { walkFolder } from './fsWalker'
import { classifyByExtension, sniffFileKind, classifyBuffer, type FileKind } from './classify'
import { openZipFromFile, openZipFromBuffer, type OpenZip, type ZipEntryInfo } from './zipReader'
import { openRarFromBuffer, type OpenRarFile, type RarEntryInfo } from './rarReader'
import { extractXmlInfo } from './xmlMatcher'
import { onlyDigits, normalizeForNameMatch } from '@shared/keyUtils'

const PARTIAL_READ_BYTES = 8 * 1024
const FULL_READ_CAP_BYTES = 5 * 1024 * 1024
const PROGRESS_THROTTLE_MS = 150
const ZIP_ENTRY_SNIFF_CAP = 10 * 1024 * 1024

interface GenericPending {
  raw: string
  normalized: string
}

export interface SearchHooks {
  onProgress: (stats: SearchStats) => void
  onFound: (item: FoundItem) => void
  onError: (error: ScanError) => void
  isCancelled: () => boolean
}

export interface SearchResult {
  stats: SearchStats
  notFound: NotFoundItem[]
  limitationNotes: string[]
}

function depthToNumber(d: ArchiveDepthOption): number {
  return d === 'unlimited' ? Number.MAX_SAFE_INTEGER : d
}

export async function runSearch(options: SearchOptions, hooks: SearchHooks): Promise<SearchResult> {
  const startedAt = Date.now()
  const maxDepth = depthToNumber(options.maxDepth)

  const pendingDigits = new Map<string, string>()
  const genericPending: GenericPending[] = []
  for (const id of options.identifiers) {
    const digits = onlyDigits(id)
    if (digits.length === 44) {
      pendingDigits.set(digits, id)
    } else {
      genericPending.push({ raw: id, normalized: normalizeForNameMatch(id) })
    }
  }
  const totalIdentifiers = pendingDigits.size + genericPending.length

  const stats: SearchStats = {
    filesScanned: 0,
    xmlAnalyzed: 0,
    zipCount: 0,
    rarCount: 0,
    foundCount: 0,
    notFoundCount: 0,
    errorCount: 0,
    elapsedMs: 0,
    estimatedTotal: totalIdentifiers,
    phase: 'buscando'
  }

  const limitationNotes = new Set<string>()
  let lastProgressAt = 0

  const emitProgress = (force = false): void => {
    stats.elapsedMs = Date.now() - startedAt
    const now = Date.now()
    if (!force && now - lastProgressAt < PROGRESS_THROTTLE_MS) return
    lastProgressAt = now
    hooks.onProgress({ ...stats })
  }

  const allResolved = (): boolean => pendingDigits.size === 0 && genericPending.length === 0

  const removeGenericMatch = (raw: string): void => {
    const idx = genericPending.findIndex((g) => g.raw === raw)
    if (idx >= 0) genericPending.splice(idx, 1)
  }

  function buildLocation(diskPath: string, chain: ChainStep[]): FileLocation {
    return { diskPath, chain }
  }

  function storageTypeFor(chain: ChainStep[]): StorageType {
    if (chain.length === 0) return 'Pasta'
    return chain[0].containerType === 'zip' ? 'ZIP' : 'RAR'
  }

  async function tryMatchCandidate(
    fileName: string,
    getPartial: () => Promise<Buffer>,
    getFull: () => Promise<Buffer>,
    diskPath: string,
    chain: ChainStep[],
    size: number,
    mtimeMs: number | null
  ): Promise<void> {
    stats.xmlAnalyzed++

    let matchedIdentifier: string | null = null
    let method: MatchMethod = 'nao_encontrado'
    let chave: string | null = null
    let docType: DocumentType = 'Desconhecido'

    const nameDigits = onlyDigits(fileName)
    if (nameDigits.length === 44 && pendingDigits.has(nameDigits)) {
      matchedIdentifier = pendingDigits.get(nameDigits)!
      method = 'nome'
      chave = nameDigits
      pendingDigits.delete(nameDigits)
    }

    if (!matchedIdentifier && genericPending.length > 0) {
      const normalizedName = normalizeForNameMatch(fileName)
      const hit = genericPending.find((g) => g.normalized.length > 0 && normalizedName.includes(g.normalized))
      if (hit) {
        matchedIdentifier = hit.raw
        method = 'nome'
        removeGenericMatch(hit.raw)
      }
    }

    if (!matchedIdentifier && (pendingDigits.size > 0 || genericPending.length > 0)) {
      try {
        let content: string
        const partial = await getPartial()
        let info = extractXmlInfo(partial.toString('utf8'))
        content = partial.toString('utf8')

        if (info.accessKeys.length === 0 && size <= FULL_READ_CAP_BYTES && partial.length >= PARTIAL_READ_BYTES) {
          const full = await getFull()
          content = full.toString('utf8')
          info = extractXmlInfo(content)
        }

        for (const key of info.accessKeys) {
          if (pendingDigits.has(key)) {
            matchedIdentifier = pendingDigits.get(key)!
            method = 'conteudo'
            chave = key
            docType = info.docType
            pendingDigits.delete(key)
            break
          }
        }

        if (!matchedIdentifier && genericPending.length > 0) {
          const hit = genericPending.find((g) => g.raw.length >= 6 && content.includes(g.raw))
          if (hit) {
            matchedIdentifier = hit.raw
            method = 'conteudo'
            docType = info.docType
            chave = info.accessKeys[0] ?? null
            removeGenericMatch(hit.raw)
          }
        }

        if (!matchedIdentifier && info.accessKeys.length > 0) {
          chave = info.accessKeys[0]
          docType = info.docType
        }
      } catch (err) {
        stats.errorCount++
        hooks.onError({
          id: randomUUID(),
          path: diskPath,
          kind: 'xml_invalido',
          message: `Falha ao ler ${fileName}: ${(err as Error).message}`
        })
        return
      }
    }

    if (matchedIdentifier) {
      stats.foundCount++
      const item: FoundItem = {
        id: randomUUID(),
        identifier: matchedIdentifier,
        status: 'encontrado',
        fileName,
        chave,
        docType,
        location: buildLocation(diskPath, chain),
        storageType: storageTypeFor(chain),
        matchMethod: method,
        sizeBytes: size,
        modifiedAt: mtimeMs
      }
      hooks.onFound(item)
      emitProgress()
    }
  }

  async function handleDiskXml(absPath: string, size: number, mtimeMs: number): Promise<void> {
    await tryMatchCandidate(
      path.basename(absPath),
      async () => readFilePartial(absPath, PARTIAL_READ_BYTES),
      async () => fs.promises.readFile(absPath),
      absPath,
      [],
      size,
      mtimeMs
    )
  }

  async function handleZipEntryXml(
    zip: OpenZip,
    entry: ZipEntryInfo,
    diskPath: string,
    parentChain: ChainStep[]
  ): Promise<void> {
    const chain = [...parentChain, { containerType: 'zip' as const, entryPath: entry.fileName, entrySize: entry.size }]
    if (entry.isEncrypted) {
      stats.errorCount++
      hooks.onError({
        id: randomUUID(),
        path: diskPath,
        kind: 'senha_protegida',
        message: `Entrada protegida por senha: ${entry.fileName}`
      })
      return
    }
    await tryMatchCandidate(
      path.basename(entry.fileName),
      () => zip.readEntry(entry, PARTIAL_READ_BYTES),
      () => zip.readEntryFull(entry),
      diskPath,
      chain,
      entry.size,
      entry.lastModified
    )
  }

  async function handleRarEntryXml(
    entry: RarEntryInfo,
    content: Buffer,
    diskPath: string,
    parentChain: ChainStep[]
  ): Promise<void> {
    const chain = [...parentChain, { containerType: 'rar' as const, entryPath: entry.fileName, entrySize: entry.size }]
    await tryMatchCandidate(
      path.basename(entry.fileName),
      async () => content,
      async () => content,
      diskPath,
      chain,
      entry.size,
      null
    )
  }

  async function descendIntoZipBuffer(
    buffer: Buffer,
    diskPath: string,
    parentChain: ChainStep[],
    depthRemaining: number
  ): Promise<void> {
    let zip: OpenZip
    try {
      zip = await openZipFromBuffer(buffer)
    } catch (err) {
      stats.errorCount++
      hooks.onError({
        id: randomUUID(),
        path: diskPath,
        kind: 'zip_corrompido',
        message: `ZIP aninhado corrompido em ${parentChain.map((c) => c.entryPath).join(' / ')}: ${(err as Error).message}`
      })
      return
    }
    try {
      await processZipEntries(zip, diskPath, parentChain, depthRemaining)
    } finally {
      zip.close()
    }
  }

  async function descendIntoRarBuffer(
    buffer: Buffer,
    diskPath: string,
    parentChain: ChainStep[],
    depthRemaining: number
  ): Promise<void> {
    let rar: OpenRarFile
    try {
      rar = await openRarFromBuffer(buffer)
    } catch (err) {
      stats.errorCount++
      hooks.onError({
        id: randomUUID(),
        path: diskPath,
        kind: 'rar_corrompido',
        message: `RAR aninhado corrompido em ${parentChain.map((c) => c.entryPath).join(' / ')}: ${(err as Error).message}`
      })
      return
    }
    await processRarEntries(rar, diskPath, parentChain, depthRemaining)
  }

  async function processZipEntries(
    zip: OpenZip,
    diskPath: string,
    parentChain: ChainStep[],
    depthRemaining: number
  ): Promise<void> {
    for (const entry of zip.entries) {
      if (hooks.isCancelled() || allResolved()) return
      if (entry.isDirectory) continue

      let kind = resolveEntryKind(entry.fileName)
      if (kind === 'other' && !entry.isEncrypted && entry.size > 0 && entry.size <= ZIP_ENTRY_SNIFF_CAP) {
        try {
          const head = await zip.readEntry(entry, 512)
          kind = classifyBuffer(head)
        } catch {
          // mantém 'other' se não for possível ler para sniff
        }
      }
      if (kind === 'xml') {
        await handleZipEntryXml(zip, entry, diskPath, parentChain)
      } else if (kind === 'zip' || kind === 'rar') {
        stats[kind === 'zip' ? 'zipCount' : 'rarCount']++
        if (depthRemaining <= 0) {
          limitationNotes.add(
            `Profundidade máxima de arquivos compactados atingida — não foi possível abrir "${entry.fileName}".`
          )
          continue
        }
        try {
          const buf = await zip.readEntryFull(entry)
          const nextChain = [...parentChain, { containerType: 'zip' as const, entryPath: entry.fileName }]
          if (kind === 'zip') await descendIntoZipBuffer(buf, diskPath, nextChain, depthRemaining - 1)
          else await descendIntoRarBuffer(buf, diskPath, nextChain, depthRemaining - 1)
        } catch (err) {
          stats.errorCount++
          hooks.onError({
            id: randomUUID(),
            path: diskPath,
            kind: 'desconhecido',
            message: `Falha ao ler arquivo aninhado ${entry.fileName}: ${(err as Error).message}`
          })
        }
      }
      emitProgress()
    }
  }

  async function processRarEntries(
    rar: OpenRarFile,
    diskPath: string,
    parentChain: ChainStep[],
    depthRemaining: number
  ): Promise<void> {
    const fileEntries = rar.entries.filter((e) => !e.isDirectory)
    for (const entry of fileEntries) {
      if (hooks.isCancelled() || allResolved()) return
      if (entry.isEncrypted) {
        stats.errorCount++
        hooks.onError({
          id: randomUUID(),
          path: diskPath,
          kind: 'senha_protegida',
          message: `Entrada protegida por senha no RAR: ${entry.fileName}`
        })
        continue
      }

      const kind = resolveEntryKind(entry.fileName)
      if (kind === 'other') continue

      let extracted: Map<string, Buffer>
      try {
        extracted = await rar.readEntries([entry.fileName])
      } catch (err) {
        stats.errorCount++
        hooks.onError({
          id: randomUUID(),
          path: diskPath,
          kind: 'rar_corrompido',
          message: `Falha ao extrair ${entry.fileName} do RAR: ${(err as Error).message}`
        })
        continue
      }
      const buf = extracted.get(entry.fileName)
      if (!buf) continue

      if (kind === 'xml') {
        await handleRarEntryXml(entry, buf, diskPath, parentChain)
      } else {
        stats[kind === 'zip' ? 'zipCount' : 'rarCount']++
        if (depthRemaining <= 0) {
          limitationNotes.add(
            `Profundidade máxima de arquivos compactados atingida — não foi possível abrir "${entry.fileName}".`
          )
          continue
        }
        const nextChain = [...parentChain, { containerType: 'rar' as const, entryPath: entry.fileName }]
        if (kind === 'zip') await descendIntoZipBuffer(buf, diskPath, nextChain, depthRemaining - 1)
        else await descendIntoRarBuffer(buf, diskPath, nextChain, depthRemaining - 1)
      }
      emitProgress()
    }
  }

  function resolveEntryKind(entryName: string): FileKind {
    const byExt = classifyByExtension(entryName)
    if (byExt) return byExt
    return 'other'
  }

  // --- Passagem principal: percorre a pasta raiz ---
  try {
    for await (const file of walkFolder(
      options.rootFolder,
      (e) => {
        stats.errorCount++
        hooks.onError({ id: randomUUID(), path: e.path, kind: 'sem_permissao', message: e.message })
      },
      () => hooks.isCancelled() || allResolved()
    )) {
      if (hooks.isCancelled() || allResolved()) break

      stats.filesScanned++
      let kind = classifyByExtension(file.absPath)
      if (!kind) kind = await sniffFileKind(file.absPath, file.size)

      if (kind === 'xml') {
        await handleDiskXml(file.absPath, file.size, file.mtimeMs)
      } else if (kind === 'zip') {
        stats.zipCount++
        try {
          const zip = await openZipFromFile(file.absPath)
          try {
            await processZipEntries(zip, file.absPath, [], maxDepth - 1)
          } finally {
            zip.close()
          }
        } catch (err) {
          stats.errorCount++
          hooks.onError({
            id: randomUUID(),
            path: file.absPath,
            kind: 'zip_corrompido',
            message: (err as Error).message
          })
        }
      } else if (kind === 'rar') {
        stats.rarCount++
        if (/\.(part(?!0*1\.rar$)\d+\.rar|r\d{2,3})$/i.test(file.absPath)) {
          limitationNotes.add(
            `Arquivos RAR multivolume não são suportados — "${path.basename(file.absPath)}" pode estar incompleto.`
          )
        }
        try {
          const buffer = await fs.promises.readFile(file.absPath)
          const rar = await openRarFromBuffer(buffer)
          await processRarEntries(rar, file.absPath, [], maxDepth - 1)
        } catch (err) {
          stats.errorCount++
          hooks.onError({
            id: randomUUID(),
            path: file.absPath,
            kind: 'rar_corrompido',
            message: (err as Error).message
          })
        }
      }

      emitProgress()
    }
  } finally {
    stats.phase = hooks.isCancelled() ? 'cancelado' : 'concluido'
    stats.elapsedMs = Date.now() - startedAt
  }

  const notFound: NotFoundItem[] = []
  for (const raw of pendingDigits.values()) {
    notFound.push({ id: randomUUID(), identifier: raw, status: 'nao_encontrado' })
  }
  for (const g of genericPending) {
    notFound.push({ id: randomUUID(), identifier: g.raw, status: 'nao_encontrado' })
  }
  stats.notFoundCount = notFound.length
  emitProgress(true)

  return { stats, notFound, limitationNotes: [...limitationNotes] }
}

async function readFilePartial(absPath: string, maxBytes: number): Promise<Buffer> {
  const fd = await fs.promises.open(absPath, 'r')
  try {
    const stat = await fd.stat()
    const size = Math.min(stat.size, maxBytes)
    const buf = Buffer.alloc(size)
    await fd.read(buf, 0, size, 0)
    return buf
  } finally {
    await fd.close()
  }
}
