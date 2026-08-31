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
import { extractXmlInfo, type XmlNoteMetadata } from './xmlMatcher'
import { onlyDigits, normalizeForNameMatch } from '@shared/keyUtils'
import { openSearchIndex, type SearchIndex } from './searchIndex'

const PARTIAL_READ_BYTES = 8 * 1024
// Teto para ler um XML inteiro atrás da chave. Precisa acomodar arquivos de lote (dezenas/centenas
// de notas em um único XML), que passam folgadamente de alguns MB.
const FULL_READ_CAP_BYTES = 20 * 1024 * 1024
const PROGRESS_THROTTLE_MS = 150
const ZIP_ENTRY_SNIFF_CAP = 10 * 1024 * 1024
/** Identificadores genéricos (não-chave) mais curtos que isso são propensos demais a falso positivo por substring. */
const MIN_GENERIC_MATCH_LENGTH = 6
/**
 * Teto de tamanho descomprimido para descer em um ZIP/RAR aninhado. Sem isso, uma entrada
 * aninhada maliciosa poderia declarar um tamanho descomprimido enorme a partir de poucos bytes
 * comprimidos (zip bomb) e forçar alocação descontrolada de memória durante a descida recursiva.
 */
const MAX_NESTED_ARCHIVE_BYTES = 200 * 1024 * 1024

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`
}

interface GenericPending {
  raw: string
  normalized: string
}

/** Um identificador satisfeito por um arquivo, com a chave de acesso que o casou (se houver). */
interface CandidateMatch {
  identifier: string
  chave: string | null
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

  // Cada chave de 44 dígitos mapeia para uma LISTA de identificadores brutos — o usuário pode
  // colar a mesma chave duas vezes com formatação diferente (com/sem traços), e cada ocorrência
  // deve gerar seu próprio resultado quando o arquivo for encontrado, em vez de uma sobrescrever
  // silenciosamente a outra.
  const pendingDigits = new Map<string, string[]>()
  const genericPending: GenericPending[] = []
  for (const id of options.identifiers) {
    const digits = onlyDigits(id)
    if (digits.length === 44) {
      const existing = pendingDigits.get(digits)
      if (existing) existing.push(id)
      else pendingDigits.set(digits, [id])
    } else {
      genericPending.push({ raw: id, normalized: normalizeForNameMatch(id) })
    }
  }
  let totalIdentifiers = genericPending.length
  for (const raws of pendingDigits.values()) totalIdentifiers += raws.length

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

  const reportError = (diskPath: string, kind: ScanError['kind'], message: string): void => {
    stats.errorCount++
    hooks.onError({ id: randomUUID(), path: diskPath, kind, message })
  }

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

  // Cache local de "chave -> onde foi encontrada da última vez" nesta pasta raiz (ver searchIndex.ts).
  // Puramente uma otimização: se indisponível, a busca segue normalmente sem ele.
  const searchIndex: SearchIndex | null = options.userDataDir ? openSearchIndex(options.userDataDir) : null
  const containerMtimeCache = new Map<string, number | null>()

  async function containerMtimeOf(diskPath: string): Promise<number | null> {
    if (containerMtimeCache.has(diskPath)) return containerMtimeCache.get(diskPath)!
    try {
      const stat = await fs.promises.stat(diskPath)
      containerMtimeCache.set(diskPath, stat.mtimeMs)
      return stat.mtimeMs
    } catch {
      containerMtimeCache.set(diskPath, null)
      return null
    }
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

    const matches: CandidateMatch[] = []
    let method: MatchMethod = 'nao_encontrado'
    let docType: DocumentType = 'Desconhecido'
    let noteMeta: Map<string, XmlNoteMetadata> | null = null

    const nameDigits = onlyDigits(fileName)
    if (nameDigits.length === 44 && pendingDigits.has(nameDigits)) {
      for (const raw of pendingDigits.get(nameDigits)!) matches.push({ identifier: raw, chave: nameDigits })
      method = 'nome'
      pendingDigits.delete(nameDigits)
    }

    if (matches.length === 0 && genericPending.length > 0) {
      const normalizedName = normalizeForNameMatch(fileName)
      const hit = genericPending.find(
        (g) => g.raw.length >= MIN_GENERIC_MATCH_LENGTH && g.normalized.length > 0 && normalizedName.includes(g.normalized)
      )
      if (hit) {
        matches.push({ identifier: hit.raw, chave: null })
        method = 'nome'
        removeGenericMatch(hit.raw)
      }
    }

    if (matches.length === 0 && (pendingDigits.size > 0 || genericPending.length > 0)) {
      try {
        const partial = await getPartial()
        let content = partial.toString('utf8')
        let info = extractXmlInfo(content)

        // Um XML de lote (enviNFe, vários nfeProc concatenados) carrega dezenas de notas, e só as
        // primeiras cabem na leitura parcial. Como não dá para saber de antemão se o arquivo é uma
        // nota só ou um lote, sempre que a leitura parcial tiver sido truncada vale ler o resto —
        // a chave procurada pode estar em qualquer ponto dele. O custo fica limitado pelo teto de
        // FULL_READ_CAP_BYTES e não afeta os XMLs de nota única, que cabem inteiros na parcial.
        if (size > partial.length && size <= FULL_READ_CAP_BYTES) {
          const full = await getFull()
          content = full.toString('utf8')
          info = extractXmlInfo(content)
        }

        // Coleta TODAS as chaves pendentes presentes no arquivo, não só a primeira: um lote
        // satisfaz vários identificadores de uma vez, cada um com sua própria chave.
        for (const key of info.accessKeys) {
          const raws = pendingDigits.get(key)
          if (raws) {
            for (const raw of raws) matches.push({ identifier: raw, chave: key })
            pendingDigits.delete(key)
          }
        }
        if (matches.length > 0) {
          method = 'conteudo'
          docType = info.docType
          noteMeta = info.notes
        }

        // Identificadores genéricos são fuzzy (substring), então casa no máximo um por arquivo
        // para não consumir vários de uma vez por engano.
        if (matches.length === 0 && genericPending.length > 0) {
          const hit = genericPending.find((g) => g.raw.length >= MIN_GENERIC_MATCH_LENGTH && content.includes(g.raw))
          if (hit) {
            matches.push({ identifier: hit.raw, chave: info.accessKeys[0] ?? null })
            method = 'conteudo'
            docType = info.docType
            noteMeta = info.notes
            removeGenericMatch(hit.raw)
          }
        }
      } catch (err) {
        reportError(diskPath, 'xml_invalido', `Falha ao ler ${fileName}: ${(err as Error).message}`)
        return
      }
    }

    // Enriquecimento best-effort: quando o match foi por nome, o conteúdo nunca foi lido, então
    // docType e os metadados de exibição (CNPJ/número/série/data) ficariam vazios. Uma leitura
    // parcial aqui não afeta se o item é reportado como encontrado — só tenta preenchê-los.
    if (method === 'nome' && matches.some((m) => m.chave)) {
      try {
        const info = extractXmlInfo((await getPartial()).toString('utf8'))
        if (docType === 'Desconhecido') docType = info.docType
        noteMeta = info.notes
      } catch {
        // best-effort — falha aqui não deve impedir o resultado já encontrado por nome
      }
    }

    if (matches.length > 0) {
      for (const { identifier, chave } of matches) {
        stats.foundCount++
        const meta = chave ? noteMeta?.get(chave) : undefined
        const item: FoundItem = {
          id: randomUUID(),
          identifier,
          status: 'encontrado',
          fileName,
          chave,
          docType,
          location: buildLocation(diskPath, chain),
          storageType: storageTypeFor(chain),
          matchMethod: method,
          sizeBytes: size,
          modifiedAt: mtimeMs,
          emitCnpj: meta?.emitCnpj ?? null,
          numero: meta?.numero ?? null,
          serie: meta?.serie ?? null,
          dataEmissao: meta?.dataEmissao ?? null
        }
        hooks.onFound(item)
      }
      if (searchIndex) {
        const cacheable = matches.filter((m) => m.chave)
        if (cacheable.length > 0) {
          const mtime = await containerMtimeOf(diskPath)
          if (mtime !== null) {
            for (const { chave } of cacheable) {
              const meta = noteMeta?.get(chave!)
              searchIndex.remember(options.rootFolder, chave!, {
                diskPath,
                chain,
                fileName,
                sizeBytes: size,
                docType,
                storageType: storageTypeFor(chain),
                containerMtimeMs: mtime,
                emitCnpj: meta?.emitCnpj ?? null,
                numero: meta?.numero ?? null,
                serie: meta?.serie ?? null,
                dataEmissao: meta?.dataEmissao ?? null
              })
            }
          }
        }
      }
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
      reportError(diskPath, 'senha_protegida', `Entrada protegida por senha: ${entry.fileName}`)
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
      reportError(
        diskPath,
        'zip_corrompido',
        `ZIP aninhado corrompido em ${parentChain.map((c) => c.entryPath).join(' / ')}: ${(err as Error).message}`
      )
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
      reportError(
        diskPath,
        'rar_corrompido',
        `RAR aninhado corrompido em ${parentChain.map((c) => c.entryPath).join(' / ')}: ${(err as Error).message}`
      )
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
        if (entry.size > MAX_NESTED_ARCHIVE_BYTES) {
          limitationNotes.add(
            `Arquivo aninhado "${entry.fileName}" excede o limite de ${formatMegabytes(MAX_NESTED_ARCHIVE_BYTES)} para descompactação e foi ignorado.`
          )
          continue
        }
        try {
          const buf = await zip.readEntryFull(entry)
          const nextChain = [...parentChain, { containerType: 'zip' as const, entryPath: entry.fileName }]
          if (kind === 'zip') await descendIntoZipBuffer(buf, diskPath, nextChain, depthRemaining - 1)
          else await descendIntoRarBuffer(buf, diskPath, nextChain, depthRemaining - 1)
        } catch (err) {
          reportError(diskPath, 'desconhecido', `Falha ao ler arquivo aninhado ${entry.fileName}: ${(err as Error).message}`)
        }
      }
      emitProgress()
    }
  }

  /**
   * Ao contrário do ZIP (yauzl lê cada entrada de forma independente e barata), o extrator RAR
   * reabre e reescaneia o arquivo inteiro do início a cada chamada de extract(). Por isso as
   * entradas necessárias são coletadas primeiro e extraídas em UMA única chamada em lote — extrair
   * entrada por entrada tornaria a busca O(n²) em RARs com muitos arquivos (arquivos fiscais reais
   * frequentemente têm milhares de XMLs por pacote).
   */
  async function processRarEntries(
    rar: OpenRarFile,
    diskPath: string,
    parentChain: ChainStep[],
    depthRemaining: number
  ): Promise<void> {
    if (hooks.isCancelled() || allResolved()) return

    const candidates: Array<{ entry: RarEntryInfo; kind: FileKind }> = []
    for (const entry of rar.entries) {
      if (entry.isDirectory) continue
      if (entry.isEncrypted) {
        reportError(diskPath, 'senha_protegida', `Entrada protegida por senha no RAR: ${entry.fileName}`)
        continue
      }
      const kind = resolveEntryKind(entry.fileName)
      if (kind === 'other') continue
      if ((kind === 'zip' || kind === 'rar') && entry.size > MAX_NESTED_ARCHIVE_BYTES) {
        stats[kind === 'zip' ? 'zipCount' : 'rarCount']++
        limitationNotes.add(
          `Arquivo aninhado "${entry.fileName}" excede o limite de ${formatMegabytes(MAX_NESTED_ARCHIVE_BYTES)} para descompactação e foi ignorado.`
        )
        continue
      }
      candidates.push({ entry, kind })
    }
    if (candidates.length === 0) return

    let extracted: Map<string, Buffer>
    try {
      extracted = await rar.readEntries(candidates.map((c) => c.entry.fileName))
    } catch (err) {
      reportError(
        diskPath,
        'rar_corrompido',
        `Falha ao extrair ${candidates.length} entrada(s) do RAR: ${(err as Error).message}`
      )
      return
    }

    for (const { entry, kind } of candidates) {
      if (hooks.isCancelled() || allResolved()) return

      const buf = extracted.get(entry.fileName)
      if (!buf) {
        reportError(diskPath, 'rar_corrompido', `Entrada extraída mas vazia/ausente no RAR: ${entry.fileName}`)
        continue
      }

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

  // --- Fase de cache: resolve o que já foi visto numa busca anterior nesta mesma pasta, antes
  // de tocar no disco. Se todas as chaves pedidas forem cache-hit, a varredura abaixo nem chega
  // a rodar (allResolved() já é true no primeiro isCancelled()||allResolved() checado).
  if (searchIndex && pendingDigits.size > 0) {
    for (const [key, raws] of [...pendingDigits]) {
      const cached = searchIndex.lookup(options.rootFolder, key)
      if (!cached) continue

      let stillValid = false
      try {
        const stat = await fs.promises.stat(cached.diskPath)
        stillValid = stat.mtimeMs === cached.containerMtimeMs
      } catch {
        stillValid = false
      }
      if (!stillValid) continue

      pendingDigits.delete(key)
      for (const raw of raws) {
        stats.foundCount++
        hooks.onFound({
          id: randomUUID(),
          identifier: raw,
          status: 'encontrado',
          fileName: cached.fileName,
          chave: key,
          docType: cached.docType,
          location: buildLocation(cached.diskPath, cached.chain),
          storageType: cached.storageType,
          matchMethod: 'indice',
          sizeBytes: cached.sizeBytes,
          modifiedAt: null,
          emitCnpj: cached.emitCnpj,
          numero: cached.numero,
          serie: cached.serie,
          dataEmissao: cached.dataEmissao
        })
      }
    }
    emitProgress(true)
  }

  // --- Passagem principal: percorre a pasta raiz ---
  try {
    for await (const file of walkFolder(
      options.rootFolder,
      (e) => reportError(e.path, 'sem_permissao', e.message),
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
          reportError(file.absPath, 'zip_corrompido', (err as Error).message)
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
          reportError(file.absPath, 'rar_corrompido', (err as Error).message)
        }
      }

      emitProgress()
    }
  } finally {
    stats.phase = hooks.isCancelled() ? 'cancelado' : 'concluido'
    stats.elapsedMs = Date.now() - startedAt
    searchIndex?.close()
  }

  const notFound: NotFoundItem[] = []
  for (const raws of pendingDigits.values()) {
    for (const raw of raws) {
      notFound.push({ id: randomUUID(), identifier: raw, status: 'nao_encontrado' })
    }
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
