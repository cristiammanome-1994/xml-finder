import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseIdentifierList,
  onlyDigits,
  normalizeForNameMatch,
  isLikelyAccessKey,
  validateAccessKey
} from './keyUtils.ts'

test('parseIdentifierList separa por linha, vírgula, ponto-e-vírgula e espaço, e remove duplicatas', () => {
  const result = parseIdentifierList('abc\n def,ghi;  jkl\tabc\n\nGHI')
  assert.deepEqual(result, ['abc', 'def', 'ghi', 'jkl'])
})

test('parseIdentifierList ignora entradas vazias', () => {
  assert.deepEqual(parseIdentifierList('  \n\n , ,\t'), [])
})

test('onlyDigits remove tudo que não é dígito', () => {
  assert.equal(onlyDigits('35240612345678000190550010000012341123456789'), '35240612345678000190550010000012341123456789')
  assert.equal(onlyDigits('3524-0612.3456/7800-0190'), '35240612345678000190')
})

test('normalizeForNameMatch remove acento, pontuação e caixa', () => {
  assert.equal(normalizeForNameMatch('Nota-Fiscal_2024 (São Paulo).xml'), 'NOTAFISCAL2024SAOPAULOXML')
})

test('isLikelyAccessKey exige exatamente 44 dígitos', () => {
  assert.equal(isLikelyAccessKey('35240612345678000190550010000012341123456789'), true)
  assert.equal(isLikelyAccessKey('123456'), false)
})

test('validateAccessKey aceita uma chave com dígito verificador correto', () => {
  // Chave de exemplo com DV calculado corretamente pelo módulo 11 (mesma regra do keyUtils).
  const body = '3524061234567800019055001000001234112345678'
  let weight = 2
  let sum = 0
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const mod = sum % 11
  const dv = mod < 2 ? 0 : 11 - mod
  const key = body + String(dv)

  assert.equal(key.length, 44)
  assert.deepEqual(validateAccessKey(key), { valid: true })
})

test('validateAccessKey rejeita dígito verificador incorreto', () => {
  const key = '35240612345678000190550010000012341123456780'
  const result = validateAccessKey(key)
  assert.equal(result.valid, false)
})

test('validateAccessKey rejeita quantidade errada de dígitos', () => {
  const result = validateAccessKey('123')
  assert.equal(result.valid, false)
  assert.match(result.reason ?? '', /44/)
})
