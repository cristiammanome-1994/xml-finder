// Tipos compartilhados entre main, preload, renderer e engine.

export type ArchiveKind = 'zip' | 'rar'

/** Um passo de abertura de arquivo compactado, do container externo para o interno. */
export interface ChainStep {
  containerType: ArchiveKind
  entryPath: string
  entrySize?: number
}

/**
 * Localização de um arquivo (XML ou não) em disco, opcionalmente dentro de
 * um ou mais níveis de arquivos compactados aninhados.
 */
export interface FileLocation {
  /** Caminho físico no disco (pasta normal, ou o arquivo .zip/.rar de nível mais externo). */
  diskPath: string
  /** Passos de abertura de arquivos compactados até chegar ao arquivo final. Vazio = arquivo solto em pasta. */
  chain: ChainStep[]
}

export type DocumentType = 'NFe' | 'NFCe' | 'CTe' | 'MDFe' | 'NFSe' | 'EFD' | 'Desconhecido'

export type MatchMethod = 'nome' | 'conteudo' | 'indice' | 'nao_encontrado'

export type StorageType = 'Pasta' | 'ZIP' | 'RAR'

export interface FoundItem {
  id: string
  identifier: string
  status: 'encontrado'
  fileName: string
  chave: string | null
  docType: DocumentType
  location: FileLocation
  storageType: StorageType
  matchMethod: MatchMethod
  sizeBytes: number
  modifiedAt: number | null
  /** Metadados extraídos do conteúdo, quando disponíveis (hoje só para NFe/NFCe). Best-effort — null quando não encontrado no XML. */
  emitCnpj: string | null
  numero: string | null
  serie: string | null
  dataEmissao: string | null
}

export interface NotFoundItem {
  id: string
  identifier: string
  status: 'nao_encontrado'
}

export type ResultItem = FoundItem | NotFoundItem

export interface ScanError {
  id: string
  path: string
  kind: 'zip_corrompido' | 'rar_corrompido' | 'xml_invalido' | 'senha_protegida' | 'sem_permissao' | 'encoding' | 'desconhecido'
  message: string
}

export type ArchiveDepthOption = 1 | 2 | 3 | 5 | 'unlimited'

export interface SearchOptions {
  rootFolder: string
  identifiers: string[]
  maxDepth: ArchiveDepthOption
  /** Preenchido pelo processo main (app.getPath('userData')) antes de enviar ao worker — usado só para localizar o índice/cache local. */
  userDataDir?: string
}

export interface SearchStats {
  filesScanned: number
  xmlAnalyzed: number
  zipCount: number
  rarCount: number
  foundCount: number
  notFoundCount: number
  errorCount: number
  elapsedMs: number
  estimatedTotal: number
  phase: 'contando' | 'buscando' | 'concluido' | 'cancelado' | 'erro'
}

export interface SearchProgressMessage {
  type: 'progress'
  stats: SearchStats
}

export interface SearchFoundMessage {
  type: 'found'
  item: FoundItem
}

export interface SearchErrorMessage {
  type: 'scan_error'
  error: ScanError
}

export interface SearchDoneMessage {
  type: 'done'
  stats: SearchStats
  notFound: NotFoundItem[]
  limitationNotes: string[]
}

export type SearchWorkerMessage =
  | SearchProgressMessage
  | SearchFoundMessage
  | SearchErrorMessage
  | SearchDoneMessage

export interface HistoryEntry {
  id: string
  date: number
  rootFolder: string
  totalIdentifiers: number
  found: number
  notFound: number
  elapsedMs: number
  results: ResultItem[]
  /** true quando a pesquisa foi cancelada antes de terminar — os "não encontrados" podem só não ter sido verificados ainda. */
  cancelled: boolean
}

export interface KeyValidation {
  valid: boolean
  reason?: string
}

export interface ExtractRequest {
  location: FileLocation
  fileName: string
  destinationFolder: string
}

export interface ExportField {
  key: keyof any
  label: string
}
