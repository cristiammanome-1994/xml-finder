import ExcelJS from 'exceljs'
import type { ResultItem, FileLocation } from '@shared/types'

function locationSummary(loc: FileLocation): { arquivoCompactado: string; caminhoInterno: string } {
  if (loc.chain.length === 0) return { arquivoCompactado: '', caminhoInterno: '' }
  return {
    arquivoCompactado: loc.diskPath,
    caminhoInterno: loc.chain.map((c) => c.entryPath).join(' / ')
  }
}

interface RowData {
  Status: string
  Chave: string
  'Nome do XML': string
  'Caminho físico': string
  'Arquivo compactado': string
  'Caminho interno': string
  Tipo: string
  'Tamanho (KB)': string
  'Data de modificação': string
  'Observação/Erro': string
}

function toRow(item: ResultItem): RowData {
  if (item.status === 'nao_encontrado') {
    return {
      Status: 'Não encontrado',
      Chave: item.identifier,
      'Nome do XML': '',
      'Caminho físico': '',
      'Arquivo compactado': '',
      'Caminho interno': '',
      Tipo: '',
      'Tamanho (KB)': '',
      'Data de modificação': '',
      'Observação/Erro': 'Nenhuma correspondência encontrada'
    }
  }

  const loc = locationSummary(item.location)
  return {
    Status: 'Encontrado',
    Chave: item.chave ?? item.identifier,
    'Nome do XML': item.fileName,
    'Caminho físico': item.location.diskPath,
    'Arquivo compactado': loc.arquivoCompactado,
    'Caminho interno': loc.caminhoInterno,
    Tipo: item.storageType,
    'Tamanho (KB)': (item.sizeBytes / 1024).toFixed(1),
    'Data de modificação': item.modifiedAt ? new Date(item.modifiedAt).toLocaleString('pt-BR') : '',
    'Observação/Erro': item.matchMethod === 'conteudo' ? 'Localizado pelo conteúdo do XML' : ''
  }
}

const COLUMNS: Array<keyof RowData> = [
  'Status',
  'Chave',
  'Nome do XML',
  'Caminho físico',
  'Arquivo compactado',
  'Caminho interno',
  'Tipo',
  'Tamanho (KB)',
  'Data de modificação',
  'Observação/Erro'
]

export async function exportToExcel(items: ResultItem[], destPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Resultados')
  sheet.columns = COLUMNS.map((c) => ({ header: c, key: c, width: c === 'Caminho físico' ? 50 : 22 }))
  for (const item of items) {
    sheet.addRow(toRow(item))
  }
  sheet.getRow(1).font = { bold: true }
  await workbook.xlsx.writeFile(destPath)
}

function csvEscape(value: string): string {
  if (/[",\n;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export async function exportToCsv(items: ResultItem[], destPath: string): Promise<void> {
  const fs = await import('node:fs')
  const lines = [COLUMNS.join(';')]
  for (const item of items) {
    const row = toRow(item)
    lines.push(COLUMNS.map((c) => csvEscape(String(row[c] ?? ''))).join(';'))
  }
  await fs.promises.writeFile(destPath, '﻿' + lines.join('\r\n'), 'utf8')
}
