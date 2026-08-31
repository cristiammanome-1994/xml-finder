import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractXmlInfo } from './xmlMatcher.ts'

const KEY1 = '35240612345678000190550010000012341123456789'
const KEY2 = '35240698765432000199550010000098761987654321'

function note(key: string, cnpj: string, nnf: string, serie: string, dhEmi: string): string {
  return `<NFe><infNFe Id="NFe${key}"><ide><nNF>${nnf}</nNF><serie>${serie}</serie><dhEmi>${dhEmi}</dhEmi></ide><emit><CNPJ>${cnpj}</CNPJ></emit></infNFe></NFe>`
}

test('extractXmlInfo acha a chave pelo atributo Id e identifica o tipo NFe', () => {
  const xml = `<nfeProc>${note(KEY1, '12345678000190', '1234', '1', '2026-08-29T10:00:00-03:00')}</nfeProc>`
  const info = extractXmlInfo(xml)
  assert.deepEqual(info.accessKeys, [KEY1])
  assert.equal(info.docType, 'NFe')
})

test('extractXmlInfo extrai CNPJ/numero/serie/data por nota, sem misturar num lote', () => {
  const batch = `<enviNFe>${note(KEY1, '12345678000190', '1234', '1', '2026-08-29T10:00:00-03:00')}${note(
    KEY2,
    '98765432000199',
    '9876',
    '2',
    '2026-08-30T11:00:00-03:00'
  )}</enviNFe>`
  const info = extractXmlInfo(batch)

  assert.deepEqual(new Set(info.accessKeys), new Set([KEY1, KEY2]))

  const meta1 = info.notes.get(KEY1)
  assert.equal(meta1?.emitCnpj, '12345678000190')
  assert.equal(meta1?.numero, '1234')
  assert.equal(meta1?.serie, '1')
  assert.equal(meta1?.dataEmissao, '2026-08-29T10:00:00-03:00')

  const meta2 = info.notes.get(KEY2)
  assert.equal(meta2?.emitCnpj, '98765432000199')
  assert.equal(meta2?.numero, '9876')
  assert.equal(meta2?.serie, '2')
})

test('extractXmlInfo cai para chNFe quando não há atributo Id (CTe/MDFe)', () => {
  const xml = `<cteProc><CTe><infCte><chCTe>${KEY1}</chCTe></infCte></CTe></cteProc>`
  const info = extractXmlInfo(xml)
  assert.deepEqual(info.accessKeys, [KEY1])
  assert.equal(info.docType, 'CTe')
})

test('extractXmlInfo cai para qualquer sequência de 44 dígitos como último recurso', () => {
  const xml = `<algumaCoisaEstranha>${KEY1}</algumaCoisaEstranha>`
  const info = extractXmlInfo(xml)
  assert.deepEqual(info.accessKeys, [KEY1])
})

test('extractXmlInfo não quebra com conteúdo vazio ou sem nenhuma chave', () => {
  const info = extractXmlInfo('<a>sem chave nenhuma aqui</a>')
  assert.deepEqual(info.accessKeys, [])
  assert.equal(info.docType, 'Desconhecido')
  assert.equal(info.notes.size, 0)
})
