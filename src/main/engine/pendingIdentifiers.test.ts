import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PendingIdentifiers } from './pendingIdentifiers.ts'

const KEY1 = '35240612345678000190550010000012341123456789'
const KEY2 = '35240698765432000199550010000098761987654321'

test('separa chaves de 44 dígitos de identificadores por nome', () => {
  const p = new PendingIdentifiers([KEY1, 'NotaFiscal001.xml'])
  assert.equal(p.total, 2)
  assert.deepEqual(p.pendingKeys(), [KEY1])
})

test('a mesma chave colada com formatações diferentes gera dois resultados, não um', () => {
  // O usuário cola a mesma chave com e sem separadores — ambas devem ser reportadas,
  // em vez de uma sobrescrever silenciosamente a outra.
  const withDashes = KEY1.replace(/(\d{4})/g, '$1 ').trim()
  const p = new PendingIdentifiers([KEY1, withDashes])

  assert.equal(p.total, 2)
  assert.deepEqual(p.pendingKeys(), [KEY1], 'as duas colapsam para a mesma chave normalizada')

  const matches = p.takeByAccessKeys([KEY1])
  assert.equal(matches.length, 2)
  assert.deepEqual(
    matches.map((m) => m.identifier).sort(),
    [KEY1, withDashes].sort()
  )
  assert.ok(p.allResolved)
})

test('takeByFileName casa a chave extraída do nome do arquivo', () => {
  const p = new PendingIdentifiers([KEY1])
  const matches = p.takeByFileName(`${KEY1}-nfe.xml`)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].chave, KEY1)
  assert.ok(p.allResolved)
})

test('takeByFileName consome no máximo um identificador genérico por arquivo', () => {
  const p = new PendingIdentifiers(['RELATORIO', 'RELATORIO_2024'])
  const matches = p.takeByFileName('RELATORIO_2024_final.xml')
  assert.equal(matches.length, 1, 'fuzzy por substring não pode engolir vários de uma vez')
  assert.equal(p.remaining().length, 1)
})

test('identificadores genéricos curtos demais não casam (evita falso positivo)', () => {
  const p = new PendingIdentifiers(['NF1'])
  assert.deepEqual(p.takeByFileName('NF1234567.xml'), [])
  assert.deepEqual(p.remaining(), ['NF1'])
})

test('takeByAccessKeys resolve várias chaves de um XML de lote de uma vez', () => {
  const p = new PendingIdentifiers([KEY1, KEY2])
  const matches = p.takeByAccessKeys([KEY1, KEY2])
  assert.equal(matches.length, 2)
  assert.ok(p.allResolved, 'um lote satisfaz todas as chaves que contém')
})

test('takeByAccessKeys ignora chaves presentes no arquivo mas não procuradas', () => {
  const p = new PendingIdentifiers([KEY1])
  const matches = p.takeByAccessKeys([KEY2, KEY1])
  assert.equal(matches.length, 1)
  assert.equal(matches[0].chave, KEY1)
})

test('um identificador já consumido não é reencontrado em outro arquivo', () => {
  const p = new PendingIdentifiers([KEY1])
  assert.equal(p.takeByAccessKeys([KEY1]).length, 1)
  assert.equal(p.takeByAccessKeys([KEY1]).length, 0, 'a busca não deve reportar a mesma chave duas vezes')
})

test('takeGenericByContent associa a chave do arquivo ao identificador por nome', () => {
  const p = new PendingIdentifiers(['PEDIDO-4455'])
  const matches = p.takeGenericByContent('<xml>...PEDIDO-4455...</xml>', KEY1)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].identifier, 'PEDIDO-4455')
  assert.equal(matches[0].chave, KEY1, 'exibe a chave do XML onde o identificador foi achado')
})

test('takeKey consome uma chave específica (caminho do índice/cache)', () => {
  const p = new PendingIdentifiers([KEY1, KEY2])
  assert.deepEqual(p.takeKey(KEY1), [KEY1])
  assert.equal(p.takeKey(KEY1), null, 'segunda tentativa não devolve nada')
  assert.deepEqual(p.pendingKeys(), [KEY2])
})

test('remaining devolve tudo que sobrou, chaves e nomes', () => {
  const p = new PendingIdentifiers([KEY1, KEY2, 'ARQUIVO_X'])
  p.takeByAccessKeys([KEY1])
  assert.deepEqual(p.remaining().sort(), [KEY2, 'ARQUIVO_X'].sort())
})

test('allResolved só é verdadeiro quando nada mais resta', () => {
  const p = new PendingIdentifiers([KEY1, 'ARQUIVO_X'])
  assert.equal(p.allResolved, false)
  p.takeByAccessKeys([KEY1])
  assert.equal(p.allResolved, false, 'ainda resta o identificador por nome')
  p.takeByFileName('ARQUIVO_X.xml')
  assert.equal(p.allResolved, true)
})

test('lista vazia de identificadores já começa resolvida', () => {
  const p = new PendingIdentifiers([])
  assert.equal(p.total, 0)
  assert.ok(p.allResolved)
})
