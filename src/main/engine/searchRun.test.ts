import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SearchRun, type SearchHooks } from './searchRun.ts'
import type { SearchOptions, ScanError, SearchStats } from '@shared/types'

/**
 * Testes unitários dos métodos autocontidos de SearchRun (emitProgress, allResolved, reportError,
 * containerMtimeOf) — extraídos de runSearch como parte de searchEngine.ts. A cobertura do
 * comportamento de ponta a ponta (percorrer pasta/ZIP/RAR, casar identificadores, etc.) já existe
 * em searchEngine.test.ts via runSearch(); aqui o objetivo é exercitar cada unidade isoladamente,
 * sem precisar rodar uma busca inteira.
 */

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xmlfinder-searchrun-test-'))
}

function baseOptions(overrides: Partial<SearchOptions> = {}): SearchOptions {
  return {
    rootFolder: tmpDir(),
    identifiers: [],
    maxDepth: 3,
    ...overrides
  }
}

function collectHooks(): SearchHooks & { found: unknown[]; errors: ScanError[]; progressCalls: SearchStats[] } {
  const found: unknown[] = []
  const errors: ScanError[] = []
  const progressCalls: SearchStats[] = []
  return {
    found,
    errors,
    progressCalls,
    onProgress: (stats) => progressCalls.push(stats),
    onFound: (item) => found.push(item),
    onError: (err) => errors.push(err),
    isCancelled: () => false
  }
}

test('SearchRun: estado inicial reflete os identificadores recebidos (estimatedTotal, phase, contadores zerados)', () => {
  const hooks = collectHooks()
  const run = new SearchRun(baseOptions({ identifiers: ['a', 'b', 'c'] }), hooks)

  const stats = run.statsSnapshot
  assert.equal(stats.estimatedTotal, 3)
  assert.equal(stats.phase, 'buscando')
  assert.equal(stats.filesScanned, 0)
  assert.equal(stats.foundCount, 0)
  assert.equal(stats.errorCount, 0)
  assert.deepEqual(run.limitationNotesList, [])
})

test('SearchRun.reportError: incrementa errorCount e repassa um ScanError completo ao hook', () => {
  const hooks = collectHooks()
  const run = new SearchRun(baseOptions(), hooks)

  run.reportError('/pasta/nota.xml', 'xml_invalido', 'XML mal formado')

  assert.equal(run.statsSnapshot.errorCount, 1)
  assert.equal(hooks.errors.length, 1)
  assert.equal(hooks.errors[0].path, '/pasta/nota.xml')
  assert.equal(hooks.errors[0].kind, 'xml_invalido')
  assert.equal(hooks.errors[0].message, 'XML mal formado')
  assert.ok(hooks.errors[0].id, 'cada erro deve ganhar um id gerado')
})

test('SearchRun.reportError: chamadas repetidas acumulam, cada uma com id distinto', () => {
  const hooks = collectHooks()
  const run = new SearchRun(baseOptions(), hooks)

  run.reportError('/a.xml', 'desconhecido', 'falha 1')
  run.reportError('/b.xml', 'desconhecido', 'falha 2')

  assert.equal(run.statsSnapshot.errorCount, 2)
  assert.equal(hooks.errors.length, 2)
  assert.notEqual(hooks.errors[0].id, hooks.errors[1].id)
})

test('SearchRun.emitProgress: throttla chamadas próximas no tempo, mas force=true sempre emite', () => {
  const hooks = collectHooks()
  const run = new SearchRun(baseOptions(), hooks)

  run.emitProgress() // primeira chamada: lastProgressAt começa em 0, então sempre passa o throttle
  assert.equal(hooks.progressCalls.length, 1)

  run.emitProgress() // imediatamente depois: cai dentro da janela de throttle, não emite de novo
  assert.equal(hooks.progressCalls.length, 1)

  run.emitProgress(true) // force ignora o throttle
  assert.equal(hooks.progressCalls.length, 2)
})

test('SearchRun.emitProgress: cada emissão é uma cópia — mutações posteriores em stats não afetam o que já foi emitido', () => {
  const hooks = collectHooks()
  const run = new SearchRun(baseOptions(), hooks)

  run.emitProgress(true)
  const firstEmitted = hooks.progressCalls[0]
  assert.equal(firstEmitted.foundCount, 0)

  run.reportError('/a.xml', 'desconhecido', 'falha')
  assert.equal(firstEmitted.errorCount, 0, 'o objeto já emitido não deve mudar com estado posterior')
  assert.equal(run.statsSnapshot.errorCount, 1)
})

test('SearchRun.allResolved: verdadeiro de imediato com lista de identificadores vazia', () => {
  const hooks = collectHooks()
  const run = new SearchRun(baseOptions({ identifiers: [] }), hooks)
  assert.equal(run.allResolved(), true)
})

test('SearchRun.allResolved: falso enquanto houver identificadores pendentes', () => {
  const hooks = collectHooks()
  const run = new SearchRun(baseOptions({ identifiers: ['35240612345678000190550010000012341123456789'] }), hooks)
  assert.equal(run.allResolved(), false)
})

test('SearchRun.containerMtimeOf: quando "known" já foi informado, devolve na hora sem tocar o disco', async () => {
  const hooks = collectHooks()
  const run = new SearchRun(baseOptions(), hooks)

  const mtime = await run.containerMtimeOf('/caminho/que/nao/existe/de/verdade.xml', 12345)
  assert.equal(mtime, 12345)
})

test('SearchRun.containerMtimeOf: sem "known", faz stat do arquivo real e depois usa cache', async () => {
  const dir = tmpDir()
  const filePath = path.join(dir, 'pacote.zip')
  fs.writeFileSync(filePath, 'conteudo')
  const expected = fs.statSync(filePath).mtimeMs

  const hooks = collectHooks()
  const run = new SearchRun(baseOptions(), hooks)

  const first = await run.containerMtimeOf(filePath, null)
  assert.equal(first, expected)

  // Remove o arquivo do disco: se a segunda chamada fosse ao disco de novo, receberia null (ENOENT).
  // Como veio do cache por-pacote, continua devolvendo o mesmo valor já resolvido.
  fs.rmSync(filePath)
  const second = await run.containerMtimeOf(filePath, null)
  assert.equal(second, expected)
})

test('SearchRun.containerMtimeOf: caminho inexistente (sem "known") resolve para null, sem lançar', async () => {
  const dir = tmpDir()
  const missing = path.join(dir, 'nunca-existiu.xml')

  const hooks = collectHooks()
  const run = new SearchRun(baseOptions(), hooks)

  const result = await run.containerMtimeOf(missing, null)
  assert.equal(result, null)

  // Também fica em cache — chamar de novo não deve lançar nem mudar o resultado.
  const again = await run.containerMtimeOf(missing, null)
  assert.equal(again, null)
})
