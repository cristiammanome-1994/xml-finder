// Caminho relativo (em vez do alias @shared) para que este módulo — e seus testes — possam ser
// carregados direto pelo runner do Node, que não conhece os aliases resolvidos pelo Vite.
import { onlyDigits, normalizeForNameMatch } from '../../shared/keyUtils.ts'

/** Identificadores genéricos (não-chave) mais curtos que isso são propensos demais a falso positivo por substring. */
const MIN_GENERIC_MATCH_LENGTH = 6

/** Um identificador satisfeito por um arquivo, com a chave de acesso que o casou (se houver). */
export interface IdentifierMatch {
  identifier: string
  chave: string | null
}

interface GenericPending {
  raw: string
  normalized: string
}

/**
 * Conjunto de identificadores ainda não localizados numa pesquisa, e as regras de casamento
 * entre eles e um arquivo candidato.
 *
 * Fica separado do orquestrador da busca (searchEngine) porque estas regras concentram a maior
 * parte da sutileza do domínio — chave repetida com formatações diferentes, XML de lote que
 * satisfaz várias chaves de uma vez, casamento fuzzy por nome — e precisam ser testáveis sem
 * depender de disco, ZIP/RAR ou worker.
 *
 * Todos os métodos `take*` são destrutivos: um identificador casado é consumido e não volta a
 * ser procurado, que é o que permite a busca parar assim que tudo foi encontrado.
 */
export class PendingIdentifiers {
  /**
   * Cada chave de 44 dígitos mapeia para uma LISTA de identificadores brutos — o usuário pode
   * colar a mesma chave duas vezes com formatação diferente (com/sem traços), e cada ocorrência
   * deve gerar seu próprio resultado quando o arquivo for encontrado, em vez de uma sobrescrever
   * silenciosamente a outra.
   */
  private readonly digits = new Map<string, string[]>()
  private generic: GenericPending[] = []
  private readonly initialTotal: number

  constructor(identifiers: string[]) {
    for (const id of identifiers) {
      const digits = onlyDigits(id)
      if (digits.length === 44) {
        const existing = this.digits.get(digits)
        if (existing) existing.push(id)
        else this.digits.set(digits, [id])
      } else {
        this.generic.push({ raw: id, normalized: normalizeForNameMatch(id) })
      }
    }

    let total = this.generic.length
    for (const raws of this.digits.values()) total += raws.length
    this.initialTotal = total
  }

  /** Quantidade de identificadores informados pelo usuário (contando repetições). */
  get total(): number {
    return this.initialTotal
  }

  /** true quando não há mais nada a procurar — a busca pode parar imediatamente. */
  get allResolved(): boolean {
    return this.digits.size === 0 && this.generic.length === 0
  }

  /** Chaves de acesso ainda pendentes, para consulta ao índice antes de varrer o disco. */
  pendingKeys(): string[] {
    return [...this.digits.keys()]
  }

  /** Consome uma chave específica (usado quando o índice já sabe onde ela está). */
  takeKey(key: string): string[] | null {
    const raws = this.digits.get(key)
    if (!raws) return null
    this.digits.delete(key)
    return raws
  }

  /**
   * Casa pelo nome do arquivo: primeiro por chave de 44 dígitos extraída do nome, depois por
   * trecho de nome. O casamento por trecho é fuzzy (substring), então consome no máximo um
   * identificador por arquivo para não engolir vários de uma vez por engano.
   */
  takeByFileName(fileName: string): IdentifierMatch[] {
    const nameDigits = onlyDigits(fileName)
    const byKey = this.digits.get(nameDigits)
    if (nameDigits.length === 44 && byKey) {
      this.digits.delete(nameDigits)
      return byKey.map((raw) => ({ identifier: raw, chave: nameDigits }))
    }

    if (this.generic.length > 0) {
      const normalizedName = normalizeForNameMatch(fileName)
      const hit = this.generic.find(
        (g) =>
          g.raw.length >= MIN_GENERIC_MATCH_LENGTH &&
          g.normalized.length > 0 &&
          normalizedName.includes(g.normalized)
      )
      if (hit) {
        this.removeGeneric(hit.raw)
        return [{ identifier: hit.raw, chave: null }]
      }
    }

    return []
  }

  /**
   * Casa pelas chaves de acesso presentes no conteúdo do XML. Coleta TODAS as chaves pendentes
   * encontradas, não só a primeira: um XML de lote satisfaz vários identificadores de uma vez,
   * cada um com sua própria chave.
   */
  takeByAccessKeys(accessKeys: Iterable<string>): IdentifierMatch[] {
    const matches: IdentifierMatch[] = []
    for (const key of accessKeys) {
      const raws = this.digits.get(key)
      if (raws) {
        for (const raw of raws) matches.push({ identifier: raw, chave: key })
        this.digits.delete(key)
      }
    }
    return matches
  }

  /**
   * Casa um identificador genérico pelo conteúdo do arquivo. Como em takeByFileName, é fuzzy e
   * consome no máximo um por chamada. `fallbackKey` é a chave associada ao resultado quando o
   * arquivo tem uma (para exibição), já que o identificador em si não é uma chave.
   */
  takeGenericByContent(content: string, fallbackKey: string | null): IdentifierMatch[] {
    if (this.generic.length === 0) return []
    const hit = this.generic.find(
      (g) => g.raw.length >= MIN_GENERIC_MATCH_LENGTH && content.includes(g.raw)
    )
    if (!hit) return []
    this.removeGeneric(hit.raw)
    return [{ identifier: hit.raw, chave: fallbackKey }]
  }

  /** Identificadores que sobraram ao fim da busca — os "não encontrados". */
  remaining(): string[] {
    const out: string[] = []
    for (const raws of this.digits.values()) out.push(...raws)
    for (const g of this.generic) out.push(g.raw)
    return out
  }

  private removeGeneric(raw: string): void {
    const idx = this.generic.findIndex((g) => g.raw === raw)
    if (idx >= 0) this.generic.splice(idx, 1)
  }
}
