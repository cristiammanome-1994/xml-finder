import type { DocumentType } from '@shared/types'

export interface XmlNoteMetadata {
  emitCnpj: string | null
  numero: string | null
  serie: string | null
  dataEmissao: string | null
}

export interface XmlContentInfo {
  accessKeys: string[]
  docType: DocumentType
  /** Metadados de exibição por chave — só populado com precisão para NFe/NFCe (ver extractNoteMetadata). */
  notes: Map<string, XmlNoteMetadata>
}

const ID_ATTR_RE = /\b(?:Id|id)\s*=\s*"([A-Za-z]{2,4}(\d{44}))"/g
const CHNFE_RE = /<(?:chNFe|chCTe|chMDFe)>\s*(\d{44})\s*<\/(?:chNFe|chCTe|chMDFe)>/g
const RAW_44_DIGIT_RE = /\b\d{44}\b/g

// Escopo de uma nota individual dentro do XML — inclusive em lotes com várias notas
// concatenadas (enviNFe, vários nfeProc). Extraído por bloco para não misturar o CNPJ/número/
// série/data de uma nota com a chave de outra nota do mesmo arquivo.
const INF_NFE_BLOCK_RE = /<infNFe\b[^>]*>[\s\S]*?<\/infNFe>/g
const BLOCK_ID_ATTR_RE = /\bId\s*=\s*"[A-Za-z]{2,4}(\d{44})"/
const EMIT_CNPJ_RE = /<emit>[\s\S]*?<CNPJ>\s*(\d{14})\s*<\/CNPJ>/
const NUMERO_RE = /<nNF>\s*(\d+)\s*<\/nNF>/
const SERIE_RE = /<serie>\s*(\d+)\s*<\/serie>/
const DATA_EMISSAO_RE = /<dhEmi>\s*([^<\s][^<]*)<\/dhEmi>|<dEmi>\s*([^<\s][^<]*)<\/dEmi>/

const DOC_TYPE_TAGS: Array<[RegExp, DocumentType]> = [
  [/<infNFe[\s>]/, 'NFe'],
  [/<infCTe[\s>]/, 'CTe'],
  [/<infMDFe[\s>]/, 'MDFe'],
  [/<infNFSe[\s>]|<InfNfse[\s>]/i, 'NFSe']
]

const MODELO_TO_DOC_TYPE: Record<string, DocumentType> = {
  '55': 'NFe',
  '65': 'NFCe',
  '57': 'CTe',
  '58': 'MDFe'
}

function extractNoteMetadata(block: string): XmlNoteMetadata {
  const emitCnpj = EMIT_CNPJ_RE.exec(block)?.[1] ?? null
  const numero = NUMERO_RE.exec(block)?.[1] ?? null
  const serie = SERIE_RE.exec(block)?.[1] ?? null
  const dataMatch = DATA_EMISSAO_RE.exec(block)
  const dataEmissao = dataMatch ? (dataMatch[1] ?? dataMatch[2] ?? null) : null
  return { emitCnpj, numero, serie, dataEmissao }
}

/**
 * Extrai as chaves de acesso, o tipo de documento e metadados de exibição do conteúdo de um XML
 * fiscal via regex leve (evita o custo de um parse DOM completo). Para NFe/NFCe, os metadados são
 * extraídos por bloco <infNFe> individual — importante em XML de lote, onde várias notas com
 * CNPJ/número/série diferentes estão concatenadas no mesmo arquivo.
 */
export function extractXmlInfo(content: string): XmlContentInfo {
  const accessKeys = new Set<string>()
  const notes = new Map<string, XmlNoteMetadata>()

  for (const block of content.matchAll(INF_NFE_BLOCK_RE)) {
    const key = BLOCK_ID_ATTR_RE.exec(block[0])?.[1]
    if (key) {
      accessKeys.add(key)
      notes.set(key, extractNoteMetadata(block[0]))
    }
  }

  for (const m of content.matchAll(ID_ATTR_RE)) accessKeys.add(m[2])
  for (const m of content.matchAll(CHNFE_RE)) accessKeys.add(m[1])
  if (accessKeys.size === 0) {
    for (const m of content.matchAll(RAW_44_DIGIT_RE)) accessKeys.add(m[0])
  }

  let docType: DocumentType = 'Desconhecido'
  for (const [re, type] of DOC_TYPE_TAGS) {
    if (re.test(content)) {
      docType = type
      break
    }
  }
  if (docType === 'Desconhecido') {
    for (const key of accessKeys) {
      // Posições 21-22 da chave de acesso carregam o modelo do documento.
      const byModelo = MODELO_TO_DOC_TYPE[key.slice(20, 22)]
      if (byModelo) {
        docType = byModelo
        break
      }
    }
  }

  return { accessKeys: [...accessKeys], docType, notes }
}
