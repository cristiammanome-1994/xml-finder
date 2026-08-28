import type { KeyValidation } from '@shared/types'

/** Divide um bloco de texto colado em identificadores individuais (uma por linha, vírgula ou espaço). */
export function parseIdentifierList(raw: string): string[] {
  const parts = raw
    .split(/[\r\n,;\t]+/g)
    .flatMap((line) => line.split(/\s+/g))
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const seen = new Set<string>()
  const result: string[] = []
  for (const p of parts) {
    const key = p.toUpperCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(p)
    }
  }
  return result
}

/** Mantém apenas dígitos de uma string. */
export function onlyDigits(s: string): string {
  return s.replace(/\D+/g, '')
}

/** Remove acentos, pontuação e espaços; deixa maiúsculo. Usado para comparação de nomes de arquivo. */
export function normalizeForNameMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
}

/** Um identificador é considerado "chave de acesso" quando, ao remover não-dígitos, sobram 44 dígitos. */
export function isLikelyAccessKey(identifier: string): boolean {
  return onlyDigits(identifier).length === 44
}

/**
 * Valida uma chave de acesso de 44 dígitos (NF-e/NFC-e/CT-e/MDF-e usam o mesmo formato)
 * pelo dígito verificador módulo 11.
 */
export function validateAccessKey(identifier: string): KeyValidation {
  const digits = onlyDigits(identifier)
  if (digits.length !== 44) {
    return { valid: false, reason: `Chave com ${digits.length} dígitos (esperado 44)` }
  }
  const body = digits.slice(0, 43)
  const dv = Number(digits[43])

  let weight = 2
  let sum = 0
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const mod = sum % 11
  const expectedDv = mod < 2 ? 0 : 11 - mod

  if (expectedDv !== dv) {
    return { valid: false, reason: 'Dígito verificador inválido' }
  }
  return { valid: true }
}

/** Chave normalizada usada como chave de índice/comparação (somente dígitos, se aplicável). */
export function comparisonKeyFor(identifier: string): { digitsKey: string | null; nameKey: string } {
  const digits = onlyDigits(identifier)
  return {
    digitsKey: digits.length >= 8 ? digits : null,
    nameKey: normalizeForNameMatch(identifier)
  }
}
