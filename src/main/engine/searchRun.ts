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
// Extensão .ts explícita (em vez do padrão dos outros arquivos de engine) porque este módulo
// também é carregado diretamente pelo runner de testes do Node, cujo resolvedor ESM exige o
// especificador exato do arquivo — o bundler de produção (Vite) aceita o mesmo especificador
// (mesmo raciocínio documentado em extractor.ts).
import { walkFolder } from './fsWalker.ts'
import { classifyByExtension, sniffFileKind, classifyBuffer, type FileKind } from './classify.ts'
import { openZipFromFile, openZipFromBuffer, type OpenZip, type ZipEntryInfo } from './zipReader.ts'
import { openRarFromBuffer, type OpenRarFile, type RarEntryInfo } from './rarReader.ts'
import { extractXmlInfo, type XmlNoteMetadata } from './xmlMatcher.ts'
import { openSearchIndex, type SearchIndex } from './searchIndex.ts'
import { PendingIdentifiers, type IdentifierMatch } from './pendingIdentifiers.ts'
import { decodeXmlBuffer } from './xmlEncoding.ts'
import { scanStreamForXml } from './streamScanner.ts'
import { MAX_NESTED_ARCHIVE_BYTES, formatMegabytes } from './archiveLimits.ts'

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
/** Mesmo raciocínio de XML_READ_CONCURRENCY, aplicado à classificação por assinatura de bytes
 * (`sniffFileKind`) de arquivos com extensão não reconhecida — ex.: PDF de DANFe ao lado do XML. */
const SNIFF_CONCURRENCY = 12

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

interface ContentMatchResult {
  matches: IdentifierMatch[]
  docType: DocumentType
  notes: Map<string, XmlNoteMetadata> | null
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

export function buildLocation(diskPath: string, chain: ChainStep[]): FileLocation {
  return { diskPath, chain }
}

export function storageTypeFor(chain: ChainStep[]): StorageType {
  if (chain.length === 0) return 'Pasta'
  return chain[0].containerType === 'zip' ? 'ZIP' : 'RAR'
}

export function resolveEntryKind(entryName: string): FileKind {
  const byExt = classifyByExtension(entryName)
  if (byExt) return byExt
  return 'other'
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

/**
 * Orquestração com estado de uma única execução de busca. Reúne o que antes eram ~15 funções
 * aninhadas dentro de `runSearch`, todas fechando sobre as mesmas variáveis por closure — aqui
 * elas viram métodos operando sobre campos da instância (`stats`, `pending`, `searchIndex`,
 * `limitationNotes`, `hooks`, `options`), o que permite testá-las isoladamente sem precisar rodar
 * uma busca inteira de ponta a ponta.
 *
 * Extração puramente estrutural: o comportamento (incluindo a ordem de operações, throttling de
 * progresso, e as proteções contra zip bomb/profundidade/cancelamento) é idêntico ao código
 * anterior — ver searchEngine.test.ts para a suíte de regressão que garante isso.
 */
export class SearchRun {
  private readonly options: SearchOptions
  private readonly hooks: SearchHooks
  private readonly maxDepth: number
  private readonly startedAt: number

  private readonly pending: PendingIdentifiers
  private readonly stats: SearchStats
  private readonly limitationNotes = new Set<string>()
  private lastProgressAt = 0

  // Cache local de "chave -> onde foi encontrada da última vez" nesta pasta raiz (ver searchIndex.ts).
  // Puramente uma otimização: se indisponível, a busca segue normalmente sem ele.
  private readonly searchIndex: SearchIndex | null
  private readonly containerMtimeCache = new Map<string, number | null>()

  private readonly inFlightXml = new Set<Promise<void>>()
  private readonly inFlightSniff = new Set<Promise<void>>()

  constructor(options: SearchOptions, hooks: SearchHooks) {
    this.options = options
    this.hooks = hooks
    this.startedAt = Date.now()
    this.maxDepth = depthToNumber(options.maxDepth)

    this.pending = new PendingIdentifiers(options.identifiers)

    this.stats = {
      filesScanned: 0,
      xmlAnalyzed: 0,
      zipCount: 0,
      rarCount: 0,
      foundCount: 0,
      notFoundCount: 0,
      errorCount: 0,
      elapsedMs: 0,
      estimatedTotal: this.pending.total,
      phase: 'buscando'
    }

    this.searchIndex = options.userDataDir ? openSearchIndex(options.userDataDir) : null
  }

  /** Cópia somente-leitura das estatísticas correntes — usada em testes unitários dos métodos abaixo. */
  get statsSnapshot(): SearchStats {
    return { ...this.stats }
  }

  /** Cópia somente-leitura das notas de limitação acumuladas até agora — mesmo uso do getter acima. */
  get limitationNotesList(): string[] {
    return [...this.limitationNotes]
  }

  /** Ponto de entrada único: executa a busca inteira e devolve o resultado final. */
  async execute(): Promise<SearchResult> {
    if (this.searchIndex) {
      await this.resolveFromCache()
    }

    try {
      await this.walk()
    } finally {
      // Mesmo em cancelamento ou erro, espera tudo em voo: ainda pode emitir resultados, e o 'done'
      // não pode ser reportado antes disso.
      await this.drainXml()
      await this.drainSniff()
      this.stats.phase = this.hooks.isCancelled() ? 'cancelado' : 'concluido'
      this.stats.elapsedMs = Date.now() - this.startedAt
      this.searchIndex?.close()
    }

    const notFound: NotFoundItem[] = this.pending
      .remaining()
      .map((identifier) => ({ id: randomUUID(), identifier, status: 'nao_encontrado' as const }))
    this.stats.notFoundCount = notFound.length
    this.emitProgress(true)

    return { stats: this.stats, notFound, limitationNotes: [...this.limitationNotes] }
  }

  // Os quatro métodos abaixo (emitProgress, allResolved, reportError, containerMtimeOf) são
  // deliberadamente públicos, e não `private`: são as unidades mais autocontidas desta classe —
  // cada uma envolve pouco ou nenhum estado além do que já é observável via statsSnapshot /
  // limitationNotesList — e por isso são testadas isoladamente em searchRun.test.ts, sem precisar
  // rodar uma busca inteira. O restante dos métodos (tryMatchCandidate, processZipEntries, etc.)
  // permanece privado: sua cobertura de regressão já vem dos testes de integração de runSearch em
  // searchEngine.test.ts, que exercitam o comportamento observável de ponta a ponta.

  emitProgress(force = false): void {
    this.stats.elapsedMs = Date.now() - this.startedAt
    const now = Date.now()
    if (!force && now - this.lastProgressAt < PROGRESS_THROTTLE_MS) return
    this.lastProgressAt = now
    this.hooks.onProgress({ ...this.stats })
  }

  allResolved(): boolean {
    return this.pending.allResolved
  }

  reportError(diskPath: string, kind: ScanError['kind'], message: string): void {
    this.stats.errorCount++
    this.hooks.onError({ id: randomUUID(), path: diskPath, kind, message })
  }

  /**
   * mtime do arquivo em disco que contém o resultado — o próprio XML, quando solto, ou o ZIP/RAR
   * externo. É o que o índice usa depois para saber se o que foi memorizado ainda vale.
   *
   * Para XML solto o walker já trouxe o mtime, então `known` evita mais uma chamada ao sistema por
   * resultado encontrado. Para entradas dentro de um pacote, `known` é o mtime da ENTRADA, não do
   * pacote, então aí o stat é necessário mesmo (e fica em cache por pacote).
   */
  async containerMtimeOf(diskPath: string, known: number | null): Promise<number | null> {
    if (known !== null) return known
    if (this.containerMtimeCache.has(diskPath)) return this.containerMtimeCache.get(diskPath)!
    try {
      const stat = await fs.promises.stat(diskPath)
      this.containerMtimeCache.set(diskPath, stat.mtimeMs)
      return stat.mtimeMs
    } catch {
      this.containerMtimeCache.set(diskPath, null)
      return null
    }
  }

  private async tryMatchCandidate(candidate: XmlCandidate): Promise<void> {
    const { fileName, diskPath, chain, size, mtimeMs } = candidate
    this.stats.xmlAnalyzed++

    let matches: IdentifierMatch[] = this.pending.takeByFileName(fileName)
    let method: MatchMethod = matches.length > 0 ? 'nome' : 'nao_encontrado'
    let docType: DocumentType = 'Desconhecido'
    let noteMeta: Map<string, XmlNoteMetadata> | null = null

    if (matches.length === 0 && !this.pending.allResolved) {
      try {
        const found = await this.matchByContent(candidate)
        matches = found.matches
        if (matches.length > 0) {
          method = 'conteudo'
          docType = found.docType
          noteMeta = found.notes
        }
      } catch (err) {
        this.reportError(diskPath, 'xml_invalido', `Falha ao ler ${fileName}: ${(err as Error).message}`)
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
        this.stats.foundCount++
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
        this.hooks.onFound(item)
      }
      if (this.searchIndex) {
        const cacheable = matches.filter((m) => m.chave)
        if (cacheable.length > 0) {
          const mtime = await this.containerMtimeOf(diskPath, chain.length === 0 ? mtimeMs : null)
          if (mtime !== null) {
            for (const { chave } of cacheable) {
              const meta = noteMeta?.get(chave!)
              this.searchIndex.remember(this.options.rootFolder, chave!, {
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
      this.emitProgress()
    }
  }

  /**
   * Procura os identificadores pendentes no CONTEÚDO do arquivo.
   *
   * Arquivos que cabem no teto de memória são lidos de uma vez (caminho normal, e o único que
   * consegue extrair os metadados por nota). Acima disso — XML de lote muito grande — o arquivo é
   * varrido em pedaços via streaming: mais lento, sem metadados, mas encontra a chave em qualquer
   * ponto do arquivo em vez de reportar um falso "não encontrado".
   */
  private async matchByContent(candidate: XmlCandidate): Promise<ContentMatchResult> {
    const empty: ContentMatchResult = { matches: [], docType: 'Desconhecido', notes: null }

    if (candidate.size > FULL_READ_CAP_BYTES && candidate.openStream) {
      return this.matchByStreaming(candidate)
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
    const byKey = this.pending.takeByAccessKeys(info.accessKeys)
    if (byKey.length > 0) {
      return { matches: byKey, docType: info.docType, notes: info.notes }
    }

    const generic = this.pending.takeGenericByContent(content, info.accessKeys[0] ?? null)
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
  private async matchByStreaming(candidate: XmlCandidate): Promise<ContentMatchResult> {
    const matches: IdentifierMatch[] = []
    let docType: DocumentType = 'Desconhecido'

    const stream = await candidate.openStream!()
    await scanStreamForXml(stream, decodeXmlBuffer, (text) => {
      const info = extractXmlInfo(text)
      if (docType === 'Desconhecido') docType = info.docType

      matches.push(...this.pending.takeByAccessKeys(info.accessKeys))
      if (matches.length === 0) {
        matches.push(...this.pending.takeGenericByContent(text, info.accessKeys[0] ?? null))
      }

      // Continua varrendo mesmo depois de achar algo: um lote grande pode conter várias das
      // chaves procuradas. Só para quando não sobrou nada a procurar, ou a busca foi cancelada.
      return this.pending.allResolved || this.hooks.isCancelled()
    })

    this.limitationNotes.add(
      `"${candidate.fileName}" tem mais de ${formatMegabytes(FULL_READ_CAP_BYTES)} e foi lido em modo de varredura — CNPJ, número e série não são extraídos nesse modo.`
    )

    return { matches, docType, notes: null }
  }

  private async handleDiskXml(absPath: string, size: number, mtimeMs: number): Promise<void> {
    await this.tryMatchCandidate({
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

  private async handleZipEntryXml(
    zip: OpenZip,
    entry: ZipEntryInfo,
    diskPath: string,
    parentChain: ChainStep[]
  ): Promise<void> {
    const chain = [...parentChain, { containerType: 'zip' as const, entryPath: entry.fileName, entrySize: entry.size }]
    if (entry.isEncrypted) {
      this.reportError(diskPath, 'senha_protegida', `Entrada protegida por senha: ${entry.fileName}`)
      return
    }
    await this.tryMatchCandidate({
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

  private async handleRarEntryXml(
    entry: RarEntryInfo,
    content: Buffer,
    diskPath: string,
    parentChain: ChainStep[]
  ): Promise<void> {
    const chain = [...parentChain, { containerType: 'rar' as const, entryPath: entry.fileName, entrySize: entry.size }]
    // O extrator de RAR já entregou o conteúdo inteiro em memória, então não há streaming a fazer:
    // readPartial e readFull servem o mesmo buffer, e o teto de memória não se aplica.
    await this.tryMatchCandidate({
      fileName: path.basename(entry.fileName),
      diskPath,
      chain,
      size: Math.min(entry.size, content.length),
      mtimeMs: null,
      readPartial: async () => content,
      readFull: async () => content
    })
  }

  private async descendIntoZipBuffer(
    buffer: Buffer,
    diskPath: string,
    parentChain: ChainStep[],
    depthRemaining: number
  ): Promise<void> {
    let zip: OpenZip
    try {
      zip = await openZipFromBuffer(buffer)
    } catch (err) {
      this.reportError(
        diskPath,
        'zip_corrompido',
        `ZIP aninhado corrompido em ${parentChain.map((c) => c.entryPath).join(' / ')}: ${(err as Error).message}`
      )
      return
    }
    try {
      await this.processZipEntries(zip, diskPath, parentChain, depthRemaining)
    } finally {
      zip.close()
    }
  }

  private async descendIntoRarBuffer(
    buffer: Buffer,
    diskPath: string,
    parentChain: ChainStep[],
    depthRemaining: number
  ): Promise<void> {
    let rar: OpenRarFile
    try {
      rar = await openRarFromBuffer(buffer)
    } catch (err) {
      this.reportError(
        diskPath,
        'rar_corrompido',
        `RAR aninhado corrompido em ${parentChain.map((c) => c.entryPath).join(' / ')}: ${(err as Error).message}`
      )
      return
    }
    await this.processRarEntries(rar, diskPath, parentChain, depthRemaining)
  }

  private async processZipEntries(
    zip: OpenZip,
    diskPath: string,
    parentChain: ChainStep[],
    depthRemaining: number
  ): Promise<void> {
    for (const entry of zip.entries) {
      if (this.hooks.isCancelled() || this.allResolved()) return
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
        await this.handleZipEntryXml(zip, entry, diskPath, parentChain)
      } else if (kind === 'zip' || kind === 'rar') {
        this.stats[kind === 'zip' ? 'zipCount' : 'rarCount']++
        if (depthRemaining <= 0) {
          this.limitationNotes.add(
            `Profundidade máxima de arquivos compactados atingida — não foi possível abrir "${entry.fileName}".`
          )
          continue
        }
        if (entry.size > MAX_NESTED_ARCHIVE_BYTES) {
          this.limitationNotes.add(
            `Arquivo aninhado "${entry.fileName}" excede o limite de ${formatMegabytes(MAX_NESTED_ARCHIVE_BYTES)} para descompactação e foi ignorado.`
          )
          continue
        }
        try {
          const buf = await zip.readEntryFull(entry)
          const nextChain = [...parentChain, { containerType: 'zip' as const, entryPath: entry.fileName }]
          if (kind === 'zip') await this.descendIntoZipBuffer(buf, diskPath, nextChain, depthRemaining - 1)
          else await this.descendIntoRarBuffer(buf, diskPath, nextChain, depthRemaining - 1)
        } catch (err) {
          this.reportError(diskPath, 'desconhecido', `Falha ao ler arquivo aninhado ${entry.fileName}: ${(err as Error).message}`)
        }
      }
      this.emitProgress()
    }
  }

  /**
   * Ao contrário do ZIP (yauzl lê cada entrada de forma independente e barata), o extrator RAR
   * reabre e reescaneia o arquivo inteiro do início a cada chamada de extract(). Por isso as
   * entradas necessárias são coletadas primeiro e extraídas em UMA única chamada em lote — extrair
   * entrada por entrada tornaria a busca O(n²) em RARs com muitos arquivos (arquivos fiscais reais
   * frequentemente têm milhares de XMLs por pacote).
   */
  private async processRarEntries(
    rar: OpenRarFile,
    diskPath: string,
    parentChain: ChainStep[],
    depthRemaining: number
  ): Promise<void> {
    if (this.hooks.isCancelled() || this.allResolved()) return

    const candidates: Array<{ entry: RarEntryInfo; kind: FileKind }> = []
    for (const entry of rar.entries) {
      if (entry.isDirectory) continue
      if (entry.isEncrypted) {
        this.reportError(diskPath, 'senha_protegida', `Entrada protegida por senha no RAR: ${entry.fileName}`)
        continue
      }
      const kind = resolveEntryKind(entry.fileName)
      if (kind === 'other') continue
      if (kind === 'zip' || kind === 'rar') {
        // Descarta ANTES de extrair — o extrator RAR materializa cada candidato inteiro em
        // memória na chamada em lote abaixo, então tanto o teto de tamanho quanto o de
        // profundidade precisam ser aplicados aqui. Checar profundidade só depois de extrair
        // (como este código fazia antes) desperdiça exatamente a proteção contra zip bomb que o
        // teto de tamanho existe para dar: um RAR no último nível permitido com várias entradas
        // logo abaixo do teto seria extraído por inteiro só para ser descartado em seguida.
        if (entry.size > MAX_NESTED_ARCHIVE_BYTES) {
          this.stats[kind === 'zip' ? 'zipCount' : 'rarCount']++
          this.limitationNotes.add(
            `Arquivo aninhado "${entry.fileName}" excede o limite de ${formatMegabytes(MAX_NESTED_ARCHIVE_BYTES)} para descompactação e foi ignorado.`
          )
          continue
        }
        if (depthRemaining <= 0) {
          this.stats[kind === 'zip' ? 'zipCount' : 'rarCount']++
          this.limitationNotes.add(
            `Profundidade máxima de arquivos compactados atingida — não foi possível abrir "${entry.fileName}".`
          )
          continue
        }
      }
      candidates.push({ entry, kind })
    }
    if (candidates.length === 0) return

    let extracted: Map<string, Buffer>
    try {
      extracted = await rar.readEntries(candidates.map((c) => c.entry.fileName))
    } catch (err) {
      this.reportError(
        diskPath,
        'rar_corrompido',
        `Falha ao extrair ${candidates.length} entrada(s) do RAR: ${(err as Error).message}`
      )
      return
    }

    for (const { entry, kind } of candidates) {
      if (this.hooks.isCancelled() || this.allResolved()) return

      const buf = extracted.get(entry.fileName)
      if (!buf) {
        this.reportError(diskPath, 'rar_corrompido', `Entrada extraída mas vazia/ausente no RAR: ${entry.fileName}`)
        continue
      }

      if (kind === 'xml') {
        await this.handleRarEntryXml(entry, buf, diskPath, parentChain)
      } else {
        // depthRemaining <= 0 já foi filtrado ao montar `candidates`, acima — chegar aqui
        // significa que ainda há profundidade disponível para descer.
        this.stats[kind === 'zip' ? 'zipCount' : 'rarCount']++
        const nextChain = [...parentChain, { containerType: 'rar' as const, entryPath: entry.fileName }]
        if (kind === 'zip') await this.descendIntoZipBuffer(buf, diskPath, nextChain, depthRemaining - 1)
        else await this.descendIntoRarBuffer(buf, diskPath, nextChain, depthRemaining - 1)
      }
      this.emitProgress()
    }
  }

  // --- Fase de cache: resolve o que já foi visto numa busca anterior nesta mesma pasta, antes
  // de tocar no disco. Se todas as chaves pedidas forem cache-hit, a varredura abaixo nem chega
  // a rodar (allResolved() já é true no primeiro isCancelled()||allResolved() checado).
  private async resolveFromCache(): Promise<void> {
    const searchIndex = this.searchIndex
    if (!searchIndex) return

    for (const key of this.pending.pendingKeys()) {
      const cached = searchIndex.lookup(this.options.rootFolder, key)
      if (!cached) continue

      let stillValid = false
      try {
        const stat = await fs.promises.stat(cached.diskPath)
        stillValid = stat.mtimeMs === cached.containerMtimeMs
      } catch {
        stillValid = false
      }
      if (!stillValid) continue

      const raws = this.pending.takeKey(key)
      if (!raws) continue
      for (const raw of raws) {
        this.stats.foundCount++
        this.hooks.onFound({
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
    this.emitProgress(true)
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
  private scheduleXml(absPath: string, size: number, mtimeMs: number): void {
    const task = this.handleDiskXml(absPath, size, mtimeMs)
      .catch((err) => this.reportError(absPath, 'desconhecido', (err as Error).message))
      .finally(() => this.inFlightXml.delete(task))
    this.inFlightXml.add(task)
  }

  /** Espera tudo que está em voo — antes de abrir um arquivo compactado (de extensão conhecida) e
   * ao fim da varredura. */
  private async drainXml(): Promise<void> {
    if (this.inFlightXml.size > 0) await Promise.all([...this.inFlightXml])
  }

  private async handleDiskZip(absPath: string): Promise<void> {
    this.stats.zipCount++
    try {
      const zip = await openZipFromFile(absPath)
      try {
        await this.processZipEntries(zip, absPath, [], this.maxDepth - 1)
      } finally {
        zip.close()
      }
    } catch (err) {
      this.reportError(absPath, 'zip_corrompido', (err as Error).message)
    }
  }

  private async handleDiskRar(absPath: string): Promise<void> {
    this.stats.rarCount++
    if (/\.(part(?!0*1\.rar$)\d+\.rar|r\d{2,3})$/i.test(absPath)) {
      this.limitationNotes.add(
        `Arquivos RAR multivolume não são suportados — "${path.basename(absPath)}" pode estar incompleto.`
      )
    }
    try {
      const buffer = await fs.promises.readFile(absPath)
      const rar = await openRarFromBuffer(buffer)
      await this.processRarEntries(rar, absPath, [], this.maxDepth - 1)
    } catch (err) {
      this.reportError(absPath, 'rar_corrompido', (err as Error).message)
    }
  }

  /**
   * Arquivos sem extensão reconhecida (`.pdf` de DANFe, `.txt`, sem extensão) também são lidos com
   * várias verificações em voo, pelo mesmo motivo do XML: identificar o tipo real por assinatura de
   * bytes (`sniffFileKind`) custa I/O, não CPU. Numa base fiscal real é comum um PDF ao lado de cada
   * XML — sem isso, cada um pagaria sozinho a latência de abrir+ler+fechar antes do próximo arquivo
   * do percurso principal sequer começar a ser classificado.
   *
   * Concessão deliberada: ao contrário do XML, uma tarefa de sniff que descobre um ZIP/RAR disfarçado
   * (sem extensão, ou renomeado) o processa por conta própria, sem esvaziar `inFlightXml`/outras
   * tarefas de sniff antes. Arquivo compactado sem extensão reconhecível é raro; o caso comum
   * (arquivo "outro" de verdade, como um PDF) nunca chega a abrir nada pesado. O `SNIFF_CONCURRENCY`
   * já limita quantos desses casos raros poderiam se sobrepor ao mesmo tempo.
   */
  private scheduleSniff(absPath: string, size: number, mtimeMs: number): void {
    const task = (async () => {
      const kind = await sniffFileKind(absPath, size)
      if (kind === 'xml') this.scheduleXml(absPath, size, mtimeMs)
      else if (kind === 'zip') await this.handleDiskZip(absPath)
      else if (kind === 'rar') await this.handleDiskRar(absPath)
      // 'other' — nada a fazer, já contabilizado em filesScanned.
    })()
      .catch((err) => this.reportError(absPath, 'desconhecido', (err as Error).message))
      .finally(() => this.inFlightSniff.delete(task))
    this.inFlightSniff.add(task)
  }

  private async drainSniff(): Promise<void> {
    if (this.inFlightSniff.size > 0) await Promise.all([...this.inFlightSniff])
  }

  private async walk(): Promise<void> {
    for await (const file of walkFolder(
      this.options.rootFolder,
      (e) => this.reportError(e.path, 'sem_permissao', e.message),
      () => this.hooks.isCancelled() || this.allResolved()
    )) {
      if (this.hooks.isCancelled() || this.allResolved()) break

      this.stats.filesScanned++
      const kind = classifyByExtension(file.absPath)

      if (kind === 'xml') {
        this.scheduleXml(file.absPath, file.size, file.mtimeMs)
        if (this.inFlightXml.size >= XML_READ_CONCURRENCY) await Promise.race([...this.inFlightXml])
        this.emitProgress()
        continue
      }

      if (kind === null) {
        // Extensão não reconhecida: precisa de sniff para saber o que é. Delegado ao pool de
        // concorrência acima — a classificação em si (e o eventual processamento, se descobrir
        // que é XML/ZIP/RAR disfarçado) roda em segundo plano.
        this.scheduleSniff(file.absPath, file.size, file.mtimeMs)
        if (this.inFlightSniff.size >= SNIFF_CONCURRENCY) await Promise.race([...this.inFlightSniff])
        this.emitProgress()
        continue
      }

      // ZIP/RAR de extensão conhecida: esvazia XML e sniff em voo antes, para não somar o pico de
      // memória de um pacote ao das leituras/classificações soltas em andamento.
      await this.drainXml()
      await this.drainSniff()

      if (kind === 'zip') await this.handleDiskZip(file.absPath)
      else if (kind === 'rar') await this.handleDiskRar(file.absPath)

      this.emitProgress()
    }
  }
}
