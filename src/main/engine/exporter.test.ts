import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exportToCsv } from './exporter.ts'
import type { FoundItem } from '../../shared/types.ts'

function foundItem(overrides: Partial<FoundItem>): FoundItem {
  return {
    id: '1',
    identifier: 'x',
    status: 'encontrado',
    fileName: 'nota.xml',
    chave: null,
    docType: 'NFe',
    location: { diskPath: 'C:/pasta/nota.xml', chain: [] },
    storageType: 'Pasta',
    matchMethod: 'nome',
    sizeBytes: 100,
    modifiedAt: null,
    emitCnpj: null,
    numero: null,
    serie: null,
    dataEmissao: null,
    ...overrides
  }
}

async function exportAndRead(items: FoundItem[]): Promise<string> {
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xmlfinder-csv-test-')), 'saida.csv')
  await exportToCsv(items, dest)
  return fs.readFileSync(dest, 'utf8')
}

test('valores que começam com = ganham prefixo de apóstrofo (mitiga CSV/Excel formula injection)', async () => {
  const csv = await exportAndRead([foundItem({ fileName: '=cmd|"/c calc"!A1.xml' })])
  assert.match(csv, /'=cmd\|/, 'o texto na coluna deve começar com apóstrofo antes do =')
})

test('valores que começam com +, -, @ ou tab também são neutralizados', async () => {
  const csv = await exportAndRead([
    foundItem({ id: 'a', emitCnpj: '+SUM(1+1)' }),
    foundItem({ id: 'b', emitCnpj: '-2+3' }),
    foundItem({ id: 'c', emitCnpj: '@SUM(A1)' })
  ])
  assert.match(csv, /'\+SUM/)
  assert.match(csv, /'-2\+3/)
  assert.match(csv, /'@SUM/)
})

test('valores normais (sem caractere de fórmula no início) não ganham prefixo', async () => {
  const csv = await exportAndRead([foundItem({ fileName: 'nota-normal.xml', emitCnpj: '11222333000144' })])
  assert.match(csv, /nota-normal\.xml/)
  assert.doesNotMatch(csv, /'nota-normal/)
  assert.doesNotMatch(csv, /'11222333000144/)
})

test('= no MEIO de um valor normal não é afetado, só no início', async () => {
  const csv = await exportAndRead([foundItem({ fileName: 'nota=teste.xml' })])
  assert.match(csv, /nota=teste\.xml/)
  assert.doesNotMatch(csv, /'nota=teste/)
})

test('item não encontrado exporta sem lançar, com colunas vazias', async () => {
  const csv = await exportAndRead([
    { id: '1', identifier: 'CHAVE-NAO-ACHADA', status: 'nao_encontrado' }
  ] as unknown as FoundItem[])
  assert.match(csv, /CHAVE-NAO-ACHADA/)
  assert.match(csv, /Nenhuma correspondência encontrada/)
})
