/**
 * Decodificação de XML fiscal respeitando o encoding declarado no próprio arquivo.
 *
 * XMLs de NF-e/CT-e vêm tanto em UTF-8 quanto em ISO-8859-1 (vários ERPs e emissores mais
 * antigos ainda geram Latin-1). Decodificar tudo como UTF-8 não atrapalha a localização da chave
 * — dígitos e nomes de tag são ASCII em qualquer um dos dois — mas corrompe todo texto acentuado
 * (razão social, endereço, descrição de produto) na visualização do XML, e faz falhar a busca por
 * trecho de nome que contenha acento.
 */

const DECLARATION_SCAN_BYTES = 256
const ENCODING_DECL_RE = /<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9_.:-]+)["']/i

const UTF8_BOM = [0xef, 0xbb, 0xbf]

/**
 * Lê o encoding declarado no prólogo do XML. O prólogo é sempre ASCII, então é seguro
 * inspecioná-lo como latin1 antes de saber o encoding real do resto do documento.
 */
export function detectXmlEncoding(buf: Buffer): string {
  if (buf.length >= 3 && UTF8_BOM.every((b, i) => buf[i] === b)) return 'utf-8'

  const head = buf.toString('latin1', 0, Math.min(buf.length, DECLARATION_SCAN_BYTES))
  const declared = ENCODING_DECL_RE.exec(head)?.[1]
  return declared ? declared.toLowerCase() : 'utf-8'
}

/**
 * Decodifica o buffer usando o encoding declarado, caindo para UTF-8 quando o rótulo é
 * desconhecido. Nunca lança: um encoding exótico vira texto (possivelmente imperfeito) em vez
 * de interromper a pesquisa ou a visualização.
 */
export function decodeXmlBuffer(buf: Buffer): string {
  const encoding = detectXmlEncoding(buf)
  if (encoding === 'utf-8' || encoding === 'utf8') return stripBom(buf.toString('utf8'))

  try {
    // TextDecoder cobre os rótulos usados na prática (iso-8859-1, windows-1252, latin1...).
    return stripBom(new TextDecoder(encoding).decode(buf))
  } catch {
    return stripBom(buf.toString('utf8'))
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}
