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
import { openSearchIndex, type SearchIndex } from './searchIndex'
import { PendingIdentifiers, type IdentifierMatch } from './pendingIdentifiers'
import { decodeXmlBuffer } from './xmlEncoding'
import { scanStreamForXml } from './streamScanner'

const PARTIAL_READ_BYTES = 8 * 1024
// Teto para ler um XML inteiro em memória atrás da chave. Precisa acomodar arquivos de lote
// (dezenas/centenas de notas em um único XML), que passam folgadamente de alguns MB. Acima disso
// o arquivo não é ignorado: passa a ser varrido em streaming, por pedaços (ver scanStreamForXml).
const FULL_READ_CAP_BYTES = 20 * 1024 * 1024
const PROGRESS_THROTTLE_MS = 150
const ZIP_ENTRY_SNIFF_CAP = 10 * 1024 * 1024
/**
 * Quantos XMLs soltos são lidos ao mesmo tempo. Medido: em série a varredura fica limitada pela
 * latência por arquivo (~99 arq/s em disco frio), não por CPU. Valor conservador o bastante para
 * não afogar o disco nem estourar o limite de descritores de arquivo do processo.
 */
const XML_READ_CONCURRENCY = 12
/**
 * Teto de tamanho descomprimido para descer em um ZIP/RAR aninhado. Sem isso, uma entrada
 * aninhada maliciosa poderia declarar um tamanho descomprimido enorme a partir de poucos bytes
 * comprimidos (zip bomb) e forçar alocação descontrolada de memória durante a descida recursiva.
 */
const MAX_NESTED_ARCHIVE_BYTES = 200 * 1024 * 1024

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`
}

/**
 * Um arquivo XML a ser avaliado, junto com as formas de ler seu conteúdo. As leituras são
 * preguiçosas porque a maioria dos candidatos casa (ou é descartada) pelo nome, sem nunca
 * precisar do conteúdo.
 */
interface XmlCandidate {
  fileName: string
  diskPath: string
  chain: ChainStep[]
  size: number
  mtimeMs: number | null
  /** Primeiros bytes — suficiente para a esmagadora maioria dos XMLs de nota única. */
  readPartial: () => Promise<Buffer>
  /** Arquivo inteiro em memória. Só chamado quando size <= FULL_READ_CAP_BYTES. */
  readFull: () => Promise<Buffer>
  /** Leitura em streaming, para arquivos grandes demais para caber em memória. */
  openStream?: () => Promise<NodeJS.ReadableStream>
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

  const pending = new PendingIdentifiers(options.identifiers)

  const stats: SearchStats = {
    filesScanned: 0,
    xmlAnalyzed: 0,
    zipCount: 0,
    rarCount: 0,
    foundCount: 0,
    notFoundCount: 0,
    errorCount: 0,
    elapsedMs: 0,
    estimatedTotal: pending.total,
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

  const allResolved = (): boolean => pending.allResolved

  const reportError = (diskPath: string, kind: ScanError['kind'], message: string): void => {
    stats.errorCount++
    hooks.onError({ id: randomUUID(), path: diskPath, kind, message })
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

  /**
   * mtime do arquivo em disco que contém o resultado — o próprio XML, quando solto, ou o ZIP/RAR
   * externo. É o que o índice usa depois para saber se o que foi memorizado ainda vale.
   *
   * Para XML solto o walker já trouxe o mtime, então `known` evita mais uma chamada ao sistema por
   * resultado encontrado. Para entradas dentro de um pacote, `known` é o mtime da ENTRADA, não do
   * pacote, então aí o stat é necessário mesmo (e fica em cache por pacote).
   */
  async function containerMtimeOf(diskPath: string, known: number | null): Promise<number | null> {
    if (known !== null) return known
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

  async function tryMatchCandidate(candidate: XmlCandidate): Promise<void> {
    const { fileName, diskPath, chain, size, mtimeMs } = candidate
    stats.xmlAnalyzed++

    let matches: IdentifierMatch[] = pending.takeByFileName(fileName)
    let method: MatchMethod = matches.length > 0 ? 'nome' : 'nao_encontrado'
    let docType: DocumentType = 'Desconhecido'
    let noteMeta: Map<string, XmlNoteMetadata> | null = null

    if (matches.length === 0 && !pending.allResolved) {
      try {
        const found = await matchByContent(candidate)
        matches = found.matches
        if (matches.length > 0) {
          method = 'conteudo'
          docType = found.docType
          noteMeta = found.notes
        }
      } catch (err) {
        reportError(diskPath, 'xml_invalido', `Falha ao ler ${fileName}: ${(err as Error).message}`)
        return
      }
    }

    if (matches.length === 0) return

    // Enriquecimento best-effort: quando o match foi por nome, o conteúdo nunca foi lido, então
    // docType e os metadados de exibição (CNPJ/número/série/data) ficariam vazios. Uma leitura
    // parcial aqui não afeta se o item é reportado como encontrado — só tenta preenchê-los.
    if (method === 'nome' && matches.some((m) => m.chave)) {
      try {
        const info = extractXmlInfo(decodeXmlBuffer(await candidate.readPartial()))
        if (docType === 'Desconhecido') docType = info.docType
        noteMeta = info.notes
      } catch {
        // best-effort — falha aqui não deve impedir o resultado já encontrado por nome
      }
    }

    {
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
          const mtime = await containerMtimeOf(diskPath, chain.length === 0 ? mtimeMs : null)
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

  interface ContentMatchResult {
    matches: IdentifierMatch[]
    docType: DocumentType
    notes: Map<string, XmlNoteMetadata> | null
  }

  /**
   * Procura os identificadores pendentes no CONTEÚDO do arquivo.
   *
   * Arquivos que cabem no teto de memória são lidos de uma vez (caminho normal, e o único que
   * consegue extrair os metadados por nota). Acima disso — XML de lote muito grande — o arquivo é
   * varrido em pedaços via streaming: mais lento, sem metadados, mas encontra a chave em qualquer
   * ponto do arquivo em vez de reportar um falso "não encontrado".
   */
  async function matchByContent(candidate: XmlCandidate): Promise<ContentMatchResult> {
    const empty: ContentMatchResult = { matches: [], docType: 'Desconhecido', notes: null }

    if (candidate.size > FULL_READ_CAP_BYTES && candidate.openStream) {
      return matchByStreaming(candidate)
    }

    const partial = await candidate.readPartial()
    let content = decodeXmlBuffer(partial)

    // Um XML de lote (enviNFe, vários nfeProc concatenados) carrega dezenas de notas, e só as
    // primeiras cabem na leitura parcial. Como não dá para saber de antemão se o arquivo é uma
    // nota só ou um lote, sempre que a leitura parcial tiver sido truncada vale ler o resto —
    // a chave procurada pode estar em qualquer ponto dele.
    if (candidate.size > partial.length && candidate.size <= FULL_READ_CAP_BYTES) {
      content = decodeXmlBuffer(await candidate.readFull())
    }

    const info = extractXmlInfo(content)
    const byKey = pending.takeByAccessKeys(info.accessKeys)
    if (byKey.length > 0) {
      return { matches: byKey, docType: info.docType, notes: info.notes }
    }

    const generic = pending.takeGenericByContent(content, info.accessKeys[0] ?? null)
    if (generic.length > 0) {
      return { matches: generic, docType: info.docType, notes: info.notes }
    }

    return empty
  }

  /**
   * Varredura por pedaços de um XML grande demais para caber em memória. Cada pedaço é analisado
   * isoladamente, então os metadados por nota (que dependem do bloco <infNFe> inteiro) não são
   * extraídos aqui — o objetivo é não perder a chave, não enriquecer o resultado.
   */
  async function matchByStreaming(candidate: XmlCandidate): Promise<ContentMatchResult> {
    const matches: IdentifierMatch[] = []
    let docType: DocumentType = 'Desconhecido'

    const stream = await candidate.openStream!()
    await scanStreamForXml(stream, decodeXmlBuffer, (text) => {
      const info = extractXmlInfo(text)
      if (docType === 'Desconhecido') docType = info.docType

      matches.push(...pending.takeByAccessKeys(info.accessKeys))
      if (matches.length === 0) {
        matches.push(...pending.takeGenericByContent(text, info.accessKeys[0] ?? null))
      }

      // Continua varrendo mesmo depois de achar algo: um lote grande pode conter várias das
      // chaves procuradas. Só para quando não sobrou nada a procurar, ou a busca foi cancelada.
      return pending.allResolved || hooks.isCancelled()
    })

    limitationNotes.add(
      `"${candidate.fileName}" tem mais de ${formatMegabytes(FULL_READ_CAP_BYTES)} e foi lido em modo de varredura — CNPJ, número e série não são extraídos nesse modo.`
    )

    return { matches, docType, notes: null }
  }

  async function handleDiskXml(absPath: string, size: number, mtimeMs: number): Promise<void> {
    await tryMatchCandidate({
      fileName: path.basename(absPath),
      diskPath: absPath,
      chain: [],
      size,
      mtimeMs,
      readPartial: () => readFilePartial(absPath, PARTIAL_READ_BYTES, size),
      readFull: () => fs.promises.readFile(absPath),
      openStream: async () => fs.createReadStream(absPath)
    })
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
    await tryMatchCandidate({
      fileName: path.basename(entry.fileName),
      diskPath,
      chain,
      size: entry.size,
      mtimeMs: entry.lastModified,
      readPartial: () => zip.readEntry(entry, PARTIAL_READ_BYTES),
      readFull: () => zip.readEntryFull(entry),
      openStream: () => zip.openEntryStream(entry)
    })
  }

  async function handleRarEntryXml(
    entry: RarEntryInfo,
    content: Buffer,
    diskPath: string,
    parentChain: ChainStep[]
  ): Promise<void> {
    const chain = [...parentChain, { containerType: 'rar' as const, entryPath: entry.fileName, entrySize: entry.size }]
    // O extrator de RAR já entregou o conteúdo inteiro em memória, então não há streaming a fazer:
    // readPartial e readFull servem o mesmo buffer, e o teto de memória não se aplica.
    await tryMatchCandidate({
      fileName: path.basename(entry.fileName),
      diskPath,
      chain,
      size: Math.min(entry.size, content.length),
      mtimeMs: null,
      readPartial: async () => content,
      readFull: async () => content
    })
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
  if (searchIndex) {
    for (const key of pending.pendingKeys()) {
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

      const raws = pending.takeKey(key)
      if (!raws) continue
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
  /**
   * XMLs soltos em disco são analisados com várias leituras em voo ao mesmo tempo.
   *
   * Cada arquivo custa um punhado de chamadas ao sistema (abrir, ler, fechar) e, medido em disco
   * frio, a latência por arquivo — não a CPU — domina o tempo total: em série, 10 mil XMLs levaram
   * ~100s (≈99 arq/s). As operações ficam quase todas esperando I/O, então sobrepô-las multiplica
   * a vazão sem custo de CPU.
   *
   * ZIP/RAR continuam sendo processados um de cada vez (ver abaixo): cada um pode carregar um
   * pacote inteiro em memória, e sobrepor vários multiplicaria o pico de uso de memória.
   */
  const inFlightXml = new Set<Promise<void>>()

  function scheduleXml(absPath: string, size: number, mtimeMs: number): void {
    const task = handleDiskXml(absPath, size, mtimeMs)
      .catch((err) => reportError(absPath, 'desconhecido', (err as Error).message))
      .finally(() => inFlightXml.delete(task))
    inFlightXml.add(task)
  }

  /** Espera tudo que está em voo — antes de abrir um arquivo compactado e ao fim da varredura. */
  async function drainXml(): Promise<void> {
    if (inFlightXml.size > 0) await Promise.all([...inFlightXml])
  }

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
        scheduleXml(file.absPath, file.size, file.mtimeMs)
        if (inFlightXml.size >= XML_READ_CONCURRENCY) await Promise.race([...inFlightXml])
        emitProgress()
        continue
      }

      // Arquivos compactados: esvazia a fila de XMLs antes, para não somar o pico de memória de
      // um pacote ao das leituras soltas em voo.
      await drainXml()

      if (kind === 'zip') {
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
    // Mesmo em cancelamento ou erro, espera as leituras em voo: elas ainda podem emitir
    // resultados, e o 'done' não pode ser reportado antes delas.
    await drainXml()
    stats.phase = hooks.isCancelled() ? 'cancelado' : 'concluido'
    stats.elapsedMs = Date.now() - startedAt
    searchIndex?.close()
  }

  const notFound: NotFoundItem[] = pending
    .remaining()
    .map((identifier) => ({ id: randomUUID(), identifier, status: 'nao_encontrado' as const }))
  stats.notFoundCount = notFound.length
  emitProgress(true)

  return { stats, notFound, limitationNotes: [...limitationNotes] }
}

/**
 * Lê no máximo `maxBytes` do início do arquivo. `knownSize` vem do stat que o walker já fez —
 * consultá-lo de novo aqui custaria mais uma chamada ao sistema por arquivo, e são elas que
 * dominam o tempo de uma varredura grande.
 */
async function readFilePartial(absPath: string, maxBytes: number, knownSize: number): Promise<Buffer> {
  // Arquivos que cabem inteiros no limite (o caso da esmagadora maioria das notas) saem em uma
  // única chamada otimizada, em vez de abrir/ler/fechar manualmente.
  if (knownSize <= maxBytes) return fs.promises.readFile(absPath)

  const fd = await fs.promises.open(absPath, 'r')
  try {
    const size = Math.min(knownSize, maxBytes)
    const buf = Buffer.alloc(size)
    await fd.read(buf, 0, size, 0)
    return buf
  } finally {
    await fd.close()
  }
}
