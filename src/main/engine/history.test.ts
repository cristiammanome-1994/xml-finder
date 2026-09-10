import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadHistory, appendHistoryEntry, clearHistory } from './history.ts'
import type { HistoryEntry } from '../../shared/types.ts'

function tmpUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xmlfinder-history-test-'))
}

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'x',
    date: Date.now(),
    rootFolder: 'C:/pasta',
    totalIdentifiers: 1,
    found: 1,
    notFound: 0,
    elapsedMs: 10,
    results: [],
    cancelled: false,
    ...overrides
  }
}

test('pasta sem histórico ainda retorna lista vazia, não lança', async () => {
  const dir = tmpUserDataDir()
  assert.deepEqual(await loadHistory(dir), [])
})

test('appendHistoryEntry grava e loadHistory lê de volta exatamente os mesmos dados', async () => {
  const dir = tmpUserDataDir()
  const entry = makeEntry({ id: 'a', rootFolder: 'C:/notas' })
  await appendHistoryEntry(dir, entry)

  const loaded = await loadHistory(dir)
  assert.equal(loaded.length, 1)
  assert.deepEqual(loaded[0], entry)
})

test('entradas novas entram no início da lista (mais recente primeiro)', async () => {
  const dir = tmpUserDataDir()
  await appendHistoryEntry(dir, makeEntry({ id: 'primeira' }))
  await appendHistoryEntry(dir, makeEntry({ id: 'segunda' }))

  const loaded = await loadHistory(dir)
  assert.deepEqual(
    loaded.map((e) => e.id),
    ['segunda', 'primeira']
  )
})

test('corte por tamanho remove as entradas mais ANTIGAS primeiro, mantendo a mais recente mesmo se ela sozinha já for grande', async () => {
  const dir = tmpUserDataDir()
  // Entradas "antigas" pequenas, para não se confundir com o gatilho de tamanho.
  await appendHistoryEntry(dir, makeEntry({ id: 'antiga-1' }))
  await appendHistoryEntry(dir, makeEntry({ id: 'antiga-2' }))

  // A nova entrada sozinha já estoura o orçamento de 15MB (MAX_HISTORY_BYTES) — não pode ser
  // removida, mesmo que isso descarte tudo o que veio antes dela.
  const enorme = makeEntry({ id: 'enorme', results: [] })
  ;(enorme as unknown as { _payload: string })._payload = 'x'.repeat(16 * 1024 * 1024)

  const result = await appendHistoryEntry(dir, enorme)
  assert.equal(result.length, 1, 'as duas entradas antigas foram descartadas para caber a nova')
  assert.equal(result[0].id, 'enorme')

  const loaded = await loadHistory(dir)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'enorme')
})

test('a serialização por corte incremental é byte a byte igual a JSON.stringify do array final', async () => {
  const dir = tmpUserDataDir()
  const entries = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' }), makeEntry({ id: 'c' })]
  for (const e of entries.slice().reverse()) await appendHistoryEntry(dir, e)

  const filePath = path.join(dir, 'xml-finder-history.json')
  const onDisk = fs.readFileSync(filePath, 'utf8')
  const parsedBack = JSON.parse(onDisk) as HistoryEntry[]

  // Reconstrução manual (mesma lógica de history.ts) precisa bater com JSON.stringify ingênuo.
  assert.equal(onDisk, JSON.stringify(parsedBack))
})

test('respeita o teto de MAX_HISTORY_ENTRIES mesmo sem estourar o tamanho', async () => {
  const dir = tmpUserDataDir()
  for (let i = 0; i < 55; i++) {
    await appendHistoryEntry(dir, makeEntry({ id: `e${i}` }))
  }
  const loaded = await loadHistory(dir)
  assert.equal(loaded.length, 50, 'corta em 50 entradas mesmo se cada uma for pequena')
  assert.equal(loaded[0].id, 'e54', 'mantém as mais recentes')
})

test('clearHistory remove o arquivo e uma leitura seguinte volta a dar lista vazia', async () => {
  const dir = tmpUserDataDir()
  await appendHistoryEntry(dir, makeEntry())
  await clearHistory(dir)
  assert.deepEqual(await loadHistory(dir), [])
})

test('clearHistory não lança se o arquivo nunca existiu', async () => {
  const dir = tmpUserDataDir()
  await assert.doesNotReject(clearHistory(dir))
})
