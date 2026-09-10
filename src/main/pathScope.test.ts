import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { PathScope } from './pathScope.ts'

test('caminho nunca associado a nenhuma pasta pesquisada é rejeitado', () => {
  const scope = new PathScope('linux')
  assert.equal(scope.isKnown('/etc/passwd'), false)
  assert.throws(() => scope.assertKnown('/etc/passwd'), /fora do escopo/)
})

test('caminho dentro da pasta lembrada é aceito — arquivo direto e em subpasta', () => {
  const scope = new PathScope('linux')
  scope.remember('/home/user/notas')
  assert.ok(scope.isKnown('/home/user/notas/nota.xml'))
  assert.ok(scope.isKnown('/home/user/notas/2024/01/lote.zip'))
})

test('a própria pasta raiz (sem arquivo dentro) conta como conhecida', () => {
  const scope = new PathScope('linux')
  scope.remember('/home/user/notas')
  assert.ok(scope.isKnown('/home/user/notas'))
})

test('pasta com prefixo de nome parecido não é aceita por engano (checa fronteira de separador)', () => {
  // "/home/user/notas2" NÃO deveria casar com a pasta lembrada "/home/user/notas" só por ter o
  // mesmo prefixo textual — precisa terminar exatamente ali ou continuar com um separador de path.
  const scope = new PathScope('linux')
  scope.remember('/home/user/notas')
  assert.equal(scope.isKnown('/home/user/notas2/arquivo.xml'), false)
  assert.equal(scope.isKnown('/home/user/notas2'), false)
})

test('caminho de uma pasta nunca lembrada continua rejeitado, mesmo com outra pasta conhecida', () => {
  const scope = new PathScope('linux')
  scope.remember('/home/user/notas')
  assert.equal(scope.isKnown('/home/user/outra-pasta/arquivo.xml'), false)
})

test('múltiplas pastas lembradas — simula reabrir histórico de uma pasta diferente da busca ao vivo', () => {
  const scope = new PathScope('linux')
  scope.remember('/home/user/busca-atual')
  scope.remember('/home/user/pasta-de-2023') // veio de uma entrada de histórico

  assert.ok(scope.isKnown('/home/user/busca-atual/nota.xml'))
  assert.ok(scope.isKnown('/home/user/pasta-de-2023/nota-antiga.xml'))
  assert.equal(scope.isKnown('/home/user/pasta-nunca-vista/nota.xml'), false)
})

test('no Windows, a comparação ignora diferença de maiúsculas/minúsculas (sistema de arquivos case-insensitive)', () => {
  const scope = new PathScope('win32')
  scope.remember('C:\\Pasta\\Notas')
  assert.ok(scope.isKnown('c:\\pasta\\notas\\arquivo.xml'))
  assert.ok(scope.isKnown('C:\\PASTA\\NOTAS\\ARQUIVO.XML'))
})

test('em plataformas não-Windows, a comparação É sensível a maiúsculas/minúsculas', () => {
  const scope = new PathScope('linux')
  scope.remember('/home/user/Notas')
  assert.equal(scope.isKnown('/home/user/notas/arquivo.xml'), false, 'minúsculo não deve casar com "Notas"')
  assert.ok(scope.isKnown('/home/user/Notas/arquivo.xml'))
})

test('caminho relativo é resolvido contra o diretório de trabalho antes de comparar', () => {
  const scope = new PathScope(process.platform)
  const abs = path.resolve('minha-pasta')
  scope.remember(abs)
  assert.ok(scope.isKnown(path.join('minha-pasta', 'arquivo.xml')))
})

test('assertKnown não lança para um caminho válido', () => {
  const scope = new PathScope('linux')
  scope.remember('/home/user/notas')
  assert.doesNotThrow(() => scope.assertKnown('/home/user/notas/nota.xml'))
})
