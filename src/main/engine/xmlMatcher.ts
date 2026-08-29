import type { DocumentType } from '@shared/types'

export interface XmlContentInfo {
  accessKeys: string[]
  docType: DocumentType
}

const ID_ATTR_RE = /\b(?:Id|id)\s*=\s*"([A-Za-z]{2,4}(\d{44}))"/g
const CHNFE_RE = /<(?:chNFe|chCTe|chMDFe)>\s*(\d{44})\s*<\/(?:chNFe|chCTe|chMDFe)>/g
const RAW_44_DIGIT_RE = /\b\d{44}\b/g

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

/**
 * Extrai as chaves de acesso e o tipo de documento do conteúdo de um XML fiscal via regex leve
 * (evita o custo de um parse DOM completo, já que só precisamos localizar chaves).
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

  return { accessKeys: [...accessKeys], docType }
}
