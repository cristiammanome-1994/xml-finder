import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyByExtension, classifyBuffer } from './classify.ts'

test('classifyByExtension reconhece .xml, .zip, .rar e ignora o resto', () => {
  assert.equal(classifyByExtension('C:/pasta/nota.xml'), 'xml')
  assert.equal(classifyByExtension('C:/pasta/lote.ZIP'), 'zip')
  assert.equal(classifyByExtension('C:/pasta/backup.rar'), 'rar')
  assert.equal(classifyByExtension('C:/pasta/relatorio.pdf'), null)
})

test('classifyBuffer detecta ZIP pela assinatura PK, mesmo sem extensão', () => {
  assert.equal(classifyBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])), 'zip')
})

test('classifyBuffer detecta RAR pela assinatura Rar!', () => {
  assert.equal(classifyBuffer(Buffer.from('Rar!\x1a\x07\x00resto', 'binary')), 'rar')
})

test('classifyBuffer detecta XML por conteúdo textual começando com < ou <?xml', () => {
  assert.equal(classifyBuffer(Buffer.from('<?xml version="1.0"?><a/>', 'utf8')), 'xml')
  assert.equal(classifyBuffer(Buffer.from('<nfeProc><NFe/></nfeProc>', 'utf8')), 'xml')
})

test('classifyBuffer retorna other para conteúdo binário desconhecido', () => {
  assert.equal(classifyBuffer(Buffer.from([0x00, 0x01, 0x02, 0x03])), 'other')
})
