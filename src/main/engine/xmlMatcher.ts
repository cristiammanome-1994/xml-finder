import type { DocumentType } from '@shared/types'
import { onlyDigits } from '@shared/keyUtils'

export interface XmlContentInfo {
  looksLikeXml: boolean
  accessKeys: string[]
  docType: DocumentType
  cnpjs: string[]
  numero: string | null
  serie: string | null
}

const ID_ATTR_RE = /\b(?:Id|id)\s*=\s*"([A-Za-z]{2,4}(\d{44}))"/g
const CHNFE_RE = /<(?:chNFe|chCTe|chMDFe)>\s*(\d{44})\s*<\/(?:chNFe|chCTe|chMDFe)>/g
const RAW_44_DIGIT_RE = /\b\d{44}\b/g
const CNPJ_RE = /<CNPJ>\s*(\d{14})\s*<\/CNPJ>/g
const NNF_RE = /<nNF>\s*(\d+)\s*<\/nNF>/
const SERIE_RE = /<serie>\s*(\d+)\s*<\/serie>/

const DOC_TYPE_TAGS: Array<[RegExp, DocumentType]> = [
  [/<infNFe[\s>]/, 'NFe'],
  [/<infCTe[\s>]/, 'CTe'],
  [/<infMDFe[\s>]/, 'MDFe'],
  [/<infNFSe[\s>]|<InfNfse[\s>]/i, 'NFSe']
]

/** Heurística rápida: o buffer parece conteúdo XML? (ignora BOM/whitespace inicial) */
export function looksLikeXml(sample: Buffer): boolean {
  let text = sample.toString('utf8', 0, Math.min(sample.length, 512))
  text = text.replace(/^﻿/, '').trimStart()
  return text.startsWith('<?xml') || (text.startsWith('<') && text.includes('>'))
}

/**
 * Extrai informações relevantes do conteúdo de um XML fiscal via regex leve
 * (evita custo de parse DOM completo quando só precisamos localizar chaves).
 */
export function extractXmlInfo(content: string): XmlContentInfo {
  const accessKeys = new Set<string>()

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
  if (docType === 'Desconhecido' && accessKeys.size > 0) {
    for (const key of accessKeys) {
      const modelo = key.slice(20, 22)
      if (modelo === '55') docType = 'NFe'
      else if (modelo === '65') docType = 'NFCe'
      else if (modelo === '57') docType = 'CTe'
      else if (modelo === '58') docType = 'MDFe'
    }
  }

  const cnpjs: string[] = []
  for (const m of content.matchAll(CNPJ_RE)) cnpjs.push(m[1])

  const numero = content.match(NNF_RE)?.[1] ?? null
  const serie = content.match(SERIE_RE)?.[1] ?? null

  return {
    looksLikeXml: true,
    accessKeys: [...accessKeys],
    docType,
    cnpjs,
    numero,
    serie
  }
}

/** Verifica se algum identificador pendente casa com as informações extraídas do XML. */
export function matchInfoAgainstIdentifiers(
  info: XmlContentInfo,
  pendingDigitsIndex: Map<string, string>
): string | null {
  for (const key of info.accessKeys) {
    const hit = pendingDigitsIndex.get(key)
    if (hit) return hit
  }
  // Fallback: CNPJ + número + série combinados não identificam unicamente uma chave de 44
  // dígitos sozinhos, então usamos apenas como sinal auxiliar — não como match direto.
  return null
}

export function digitsFromIdentifier(identifier: string): string {
  return onlyDigits(identifier)
}
