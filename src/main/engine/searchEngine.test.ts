import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { runSearch, buildLocation, storageTypeFor, resolveEntryKind, type SearchHooks } from './searchEngine.ts'
import type { SearchOptions, FoundItem, ScanError, SearchStats } from '@shared/types'

const KEY1 = '35240612345678000190550010000012341123456789'
const KEY2 = '35240698765432000199550010000098761987654321'

function note(key: string, cnpj: string, nnf: string, serie: string, dhEmi: string): string {
  return `<NFe><infNFe Id="NFe${key}"><ide><nNF>${nnf}</nNF><serie>${serie}</serie><dhEmi>${dhEmi}</dhEmi></ide><emit><CNPJ>${cnpj}</CNPJ></emit></infNFe></NFe>`
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xmlfinder-searchengine-test-'))
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n)
  return b
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0)
  return b
}

/**
 * Monta um ZIP mínimo de uma entrada só. `declaredUncompressedSize` permite forjar o tamanho
 * descomprimido no cabeçalho, independente do conteúdo real comprimido — mesmo truque usado em
 * extractor.test.ts para simular um zip bomb sem precisar de 200MB de dados reais.
 */
function buildZip(entryName: string, content: Buffer, declaredUncompressedSize?: number): Buffer {
  const raw = zlib.deflateRawSync(content)
  const name = Buffer.from(entryName)
  const uncompSize = declaredUncompressedSize ?? content.length
  const crc = 0
  const lfh = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc), u32(raw.length), u32(uncompSize), u16(name.length), u16(0), name
  ])
  const cd = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc), u32(raw.length), u32(uncompSize), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name
  ])
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(cd.length), u32(lfh.length + raw.length), u16(0)])
  return Buffer.concat([lfh, raw, cd, eocd])
}

function baseOptions(overrides: Partial<SearchOptions> = {}): SearchOptions {
  return {
    rootFolder: tmpDir(),
    identifiers: [],
    maxDepth: 3,
    ...overrides
  }
}

/** Coletor de hooks: acumula found/error/progress para asserções, sem exigir cancelamento a menos que pedido. */
function collectHooks(opts: { cancelAfter?: number } = {}): SearchHooks & { found: FoundItem[]; errors: ScanError[]; lastStats: SearchStats | null } {
  let progressCalls = 0
  const found: FoundItem[] = []
  const errors: ScanError[] = []
  let lastStats: SearchStats | null = null
  return {
    found,
    errors,
    get lastStats() {
      return lastStats
    },
    onProgress: (stats) => {
      progressCalls++
      lastStats = stats
    },
    onFound: (item) => found.push(item),
    onError: (err) => errors.push(err),
    isCancelled: () => (opts.cancelAfter !== undefined ? progressCalls > opts.cancelAfter : false)
  }
}

test('runSearch: XML solto casado pelo NOME do arquivo (chave de 44 dígitos no nome)', async () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, `${KEY1}-nota.xml`), 'conteúdo irrelevante, o nome já casa')

  const hooks = collectHooks()
  const result = await runSearch(baseOptions({ rootFolder: dir, identifiers: [KEY1] }), hooks)

  assert.equal(hooks.found.length, 1)
  assert.equal(hooks.found[0].matchMethod, 'nome')
  assert.equal(hooks.found[0].storageType, 'Pasta')
  assert.equal(result.notFound.length, 0)
  assert.equal(result.stats.foundCount, 1)
})

test('runSearch: XML solto casado pelo CONTEÚDO (nome do arquivo não bate com a chave)', async () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, 'nota_qualquer.xml'), note(KEY1, '12345678000190', '1234', '1', '2026-08-29T10:00:00-03:00'))

  const hooks = collectHooks()
  const result = await runSearch(baseOptions({ rootFolder: dir, identifiers: [KEY1] }), hooks)

  assert.equal(hooks.found.length, 1)
  assert.equal(hooks.found[0].matchMethod, 'conteudo')
  assert.equal(hooks.found[0].emitCnpj, '12345678000190')
  assert.equal(result.stats.notFoundCount, 0)
})

test('runSearch: XML de lote satisfaz várias chaves de uma vez, cada uma com seus próprios metadados', async () => {
  const dir = tmpDir()
  const batch = `<enviNFe>${note(KEY1, '12345678000190', '1234', '1', '2026-08-29T10:00:00-03:00')}${note(
    KEY2,
    '98765432000199',
    '9876',
    '2',
    '2026-08-30T11:00:00-03:00'
  )}</enviNFe>`
  fs.writeFileSync(path.join(dir, 'lote.xml'), batch)

  const hooks = collectHooks()
  const result = await runSearch(baseOptions({ rootFolder: dir, identifiers: [KEY1, KEY2] }), hooks)

  assert.equal(hooks.found.length, 2)
  const byKey = new Map(hooks.found.map((f) => [f.chave, f]))
  assert.equal(byKey.get(KEY1)?.numero, '1234')
  assert.equal(byKey.get(KEY2)?.numero, '9876')
  assert.equal(result.notFound.length, 0)
})

test('runSearch: encontra XML dentro de um ZIP e reporta storageType/chain corretos', async () => {
  const dir = tmpDir()
  fs.writeFileSync(
    path.join(dir, 'pacote.zip'),
    buildZip('nota.xml', Buffer.from(note(KEY1, '12345678000190', '1', '1', '2026-08-29T10:00:00-03:00')))
  )

  const hooks = collectHooks()
  const result = await runSearch(baseOptions({ rootFolder: dir, identifiers: [KEY1] }), hooks)

  assert.equal(hooks.found.length, 1)
  assert.equal(hooks.found[0].storageType, 'ZIP')
  assert.equal(hooks.found[0].location.chain[0]?.entryPath, 'nota.xml')
  assert.equal(result.stats.zipCount, 1)
})

test('runSearch: respeita a profundidade máxima configurada e registra limitationNote, sem travar', async () => {
  const dir = tmpDir()
  const inner = buildZip('nota.xml', Buffer.from(note(KEY1, '12345678000190', '1', '1', '2026-08-29T10:00:00-03:00')))
  const outer = buildZip('interno.zip', inner)
  fs.writeFileSync(path.join(dir, 'externo.zip'), outer)

  const hooks = collectHooks()
  // maxDepth=1: o zip externo já ocupa o único nível permitido, então o interno não pode ser aberto.
  const result = await runSearch(baseOptions({ rootFolder: dir, identifiers: [KEY1], maxDepth: 1 }), hooks)

  assert.equal(hooks.found.length, 0)
  assert.equal(result.notFound.length, 1)
  assert.ok(
    result.limitationNotes.some((n) => /profundidade máxima/i.test(n)),
    `esperava nota de limite de profundidade, recebi: ${JSON.stringify(result.limitationNotes)}`
  )
})

test('runSearch: recusa abrir arquivo aninhado acima do teto de tamanho (zip bomb) e continua a busca', async () => {
  const dir = tmpDir()
  // Declara 500MB de tamanho descomprimido a partir de pouquíssimos bytes reais comprimidos —
  // igual ao golpe testado em extractor.test.ts, mas aqui a proteção é a de searchEngine.ts
  // (checada ANTES de extrair o buffer inteiro, não depois).
  const bomb = buildZip('bomba.zip', Buffer.from('x'.repeat(1000)), 500 * 1024 * 1024)
  const outer = buildZip('bomba.zip', bomb) // entrada "bomba.zip" dentro do zip externo
  fs.writeFileSync(path.join(dir, 'externo.zip'), outer)

  const hooks = collectHooks()
  const result = await runSearch(baseOptions({ rootFolder: dir, identifiers: [KEY1] }), hooks)

  assert.equal(hooks.found.length, 0)
  assert.equal(hooks.errors.length, 0, 'o teto de tamanho não deve virar erro — é um limite conhecido, registrado em limitationNotes')
  assert.ok(
    result.limitationNotes.some((n) => /200MB|limite/i.test(n)),
    `esperava nota de limite de tamanho, recebi: ${JSON.stringify(result.limitationNotes)}`
  )
  assert.equal(result.stats.phase, 'concluido', 'a busca deve terminar normalmente, não travar nem abortar')
})

test('runSearch: segunda busca na mesma pasta responde pelo índice local, sem varrer o disco de novo', async () => {
  const dir = tmpDir()
  const userDataDir = tmpDir()
  fs.writeFileSync(path.join(dir, 'nota.xml'), note(KEY1, '12345678000190', '1', '1', '2026-08-29T10:00:00-03:00'))

  const first = collectHooks()
  await runSearch(baseOptions({ rootFolder: dir, identifiers: [KEY1], userDataDir }), first)
  assert.equal(first.found[0]?.matchMethod, 'conteudo')

  const second = collectHooks()
  const result = await runSearch(baseOptions({ rootFolder: dir, identifiers: [KEY1], userDataDir }), second)

  assert.equal(second.found.length, 1)
  assert.equal(second.found[0].matchMethod, 'indice')
  assert.equal(result.stats.filesScanned, 0, 'com tudo resolvido pelo índice, a varredura de arquivos nem deveria começar')
})

test('runSearch: cancelamento interrompe a busca e reporta phase "cancelado"', async () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, 'nota.xml'), note(KEY1, '12345678000190', '1', '1', '2026-08-29T10:00:00-03:00'))

  const hooks: SearchHooks = {
    onProgress: () => {},
    onFound: () => {},
    onError: () => {},
    isCancelled: () => true
  }
  const result = await runSearch(baseOptions({ rootFolder: dir, identifiers: [KEY1] }), hooks)

  assert.equal(result.stats.phase, 'cancelado')
  assert.equal(result.notFound.length, 1, 'busca cancelada antes de achar nada deve devolver o identificador como não encontrado')
})

test('runSearch: pasta vazia com identificadores pendentes devolve tudo como não encontrado, sem erro', async () => {
  const dir = tmpDir()
  const hooks = collectHooks()
  const result = await runSearch(baseOptions({ rootFolder: dir, identifiers: [KEY1, 'nota-fiscal-abc'] }), hooks)

  assert.equal(hooks.found.length, 0)
  assert.equal(hooks.errors.length, 0)
  assert.equal(result.notFound.length, 2)
  assert.equal(result.stats.phase, 'concluido')
})

test('buildLocation monta FileLocation a partir de diskPath e chain', () => {
  const loc = buildLocation('/pasta/pacote.zip', [{ containerType: 'zip', entryPath: 'a.xml' }])
  assert.deepEqual(loc, { diskPath: '/pasta/pacote.zip', chain: [{ containerType: 'zip', entryPath: 'a.xml' }] })
})

test('storageTypeFor: pasta sem chain, ZIP/RAR conforme o primeiro passo da chain', () => {
  assert.equal(storageTypeFor([]), 'Pasta')
  assert.equal(storageTypeFor([{ containerType: 'zip', entryPath: 'a.xml' }]), 'ZIP')
  assert.equal(storageTypeFor([{ containerType: 'rar', entryPath: 'a.xml' }]), 'RAR')
  // Só o container mais externo (primeiro passo) decide o storageType exibido, mesmo com aninhamento.
  assert.equal(
    storageTypeFor([
      { containerType: 'zip', entryPath: 'meio.rar' },
      { containerType: 'rar', entryPath: 'a.xml' }
    ]),
    'ZIP'
  )
})

test('resolveEntryKind classifica por extensão e cai para "other" quando desconhecida', () => {
  assert.equal(resolveEntryKind('nota.xml'), 'xml')
  assert.equal(resolveEntryKind('pacote.zip'), 'zip')
  assert.equal(resolveEntryKind('pacote.rar'), 'rar')
  assert.equal(resolveEntryKind('danfe.pdf'), 'other')
  assert.equal(resolveEntryKind('sem_extensao'), 'other')
})
