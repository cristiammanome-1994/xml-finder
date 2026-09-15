import { beforeEach, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useStore } from '../store'
import { ResultsTable } from './ResultsTable'
import type { FoundItem, NotFoundItem, ScanError } from '@shared/types'

function mockApi(overrides: Partial<Window['api']> = {}): void {
  window.api = {
    selectFolder: vi.fn(),
    selectDestinationFolder: vi.fn(),
    startSearch: vi.fn(),
    cancelSearch: vi.fn(),
    onSearchMessage: vi.fn(),
    openContainingFolder: vi.fn(),
    readXmlContent: vi.fn(),
    extractSingle: vi.fn(),
    exportResults: vi.fn(),
    listHistory: vi.fn(),
    appendHistory: vi.fn(),
    clearHistory: vi.fn(),
    clearSearchIndex: vi.fn(),
    ...overrides
  }
}

function foundItem(overrides: Partial<FoundItem> = {}): FoundItem {
  return {
    id: 'f1',
    identifier: '35200114200166000166550010000000015123456789',
    status: 'encontrado',
    fileName: 'nfe-1.xml',
    chave: '35200114200166000166550010000000015123456789',
    docType: 'NFe',
    location: { diskPath: 'C:\\pasta\\nfe-1.xml', chain: [] },
    storageType: 'Pasta',
    matchMethod: 'nome',
    sizeBytes: 2048,
    modifiedAt: null,
    emitCnpj: null,
    numero: null,
    serie: null,
    dataEmissao: null,
    ...overrides
  }
}

function notFoundItem(overrides: Partial<NotFoundItem> = {}): NotFoundItem {
  return {
    id: 'nf1',
    identifier: '35200114200166000166550010000000099999999',
    status: 'nao_encontrado',
    ...overrides
  }
}

function scanError(overrides: Partial<ScanError> = {}): ScanError {
  return {
    id: 'e1',
    path: 'C:\\pasta\\arquivo.zip',
    kind: 'zip_corrompido',
    message: 'Arquivo zip corrompido',
    ...overrides
  }
}

beforeEach(() => {
  useStore.setState({
    found: [],
    notFound: [],
    errors: [],
    filter: 'todos',
    selectedItem: null,
    hasSearched: false,
    searching: false,
    toast: null,
    toastToken: 0
  })
  mockApi()
})

test('estado vazio: sem busca feita e sem busca em andamento, mostra o roteiro de primeiros passos', () => {
  render(<ResultsTable />)
  expect(screen.getByText('Comece uma pesquisa')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

test('busca em andamento sem resultado ainda: já mostra a barra de filtros, não o roteiro', () => {
  useStore.setState({ hasSearched: false, searching: true })
  render(<ResultsTable />)
  expect(screen.queryByText('Comece uma pesquisa')).not.toBeInTheDocument()
  expect(screen.getByRole('tablist', { name: 'Filtrar resultados' })).toBeInTheDocument()
})

test('filtro "Todos": lista encontrados e não encontrados juntos, com tamanho formatado', () => {
  useStore.setState({
    hasSearched: true,
    found: [foundItem()],
    notFound: [notFoundItem()]
  })
  render(<ResultsTable />)

  const rows = screen.getAllByRole('button', { name: /Ver detalhes/ })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toHaveTextContent('nfe-1.xml')
  expect(rows[0]).toHaveTextContent('2.0 KB')
  expect(screen.getByText('35200114200166000166550010000000099999999')).toBeInTheDocument()
})

test('localização de um XML dentro de ZIP mostra o arquivo compactado e o caminho interno', () => {
  useStore.setState({
    hasSearched: true,
    found: [
      foundItem({
        location: {
          diskPath: 'C:\\pasta\\lote.zip',
          chain: [{ containerType: 'zip', entryPath: 'notas/nfe-1.xml' }]
        }
      })
    ]
  })
  render(<ResultsTable />)
  expect(screen.getByText('lote.zip / nfe-1.xml')).toBeInTheDocument()
})

test('aba "Erros" mostra a contagem e, quando ativa, lista os erros em vez da tabela de resultados', () => {
  useStore.setState({
    hasSearched: true,
    errors: [
      scanError(),
      scanError({ id: 'e2', path: 'C:\\pasta\\outro.rar', kind: 'rar_corrompido', message: 'Arquivo rar corrompido' })
    ]
  })
  render(<ResultsTable />)

  const errorsTab = screen.getByRole('tab', { name: 'Erros (2)' })
  expect(screen.queryByText('Arquivo zip corrompido')).not.toBeInTheDocument()

  fireEvent.click(errorsTab)

  expect(useStore.getState().filter).toBe('erros')
  expect(screen.getByText('Arquivo zip corrompido')).toBeInTheDocument()
  expect(screen.getByText('Arquivo rar corrompido')).toBeInTheDocument()
  expect(screen.getByText('C:\\pasta\\outro.rar')).toBeInTheDocument()
})

test('clicar em uma linha "encontrado" seleciona o item; clicar em "não encontrado" não faz nada', () => {
  const found = foundItem()
  const notFound = notFoundItem()
  useStore.setState({ hasSearched: true, found: [found], notFound: [notFound] })
  render(<ResultsTable />)

  fireEvent.click(screen.getByText(notFound.identifier).closest('tr')!)
  expect(useStore.getState().selectedItem).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes de nfe-1.xml' }))
  expect(useStore.getState().selectedItem).toEqual(found)
})

test('pressionar Enter numa linha "encontrado" também abre os detalhes', () => {
  const found = foundItem()
  useStore.setState({ hasSearched: true, found: [found] })
  render(<ResultsTable />)

  fireEvent.keyDown(screen.getByRole('button', { name: 'Ver detalhes de nfe-1.xml' }), { key: 'Enter' })
  expect(useStore.getState().selectedItem).toEqual(found)
})

test('botões de exportar ficam desabilitados sem resultados', () => {
  useStore.setState({ hasSearched: true })
  render(<ResultsTable />)
  expect(screen.getByRole('button', { name: /Exportar Excel/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /Exportar CSV/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /Exportar não encontrados/ })).toBeDisabled()
})

test('exportar Excel chama a API com todos os resultados e mostra um toast de sucesso', async () => {
  const exportResults = vi.fn().mockResolvedValue('C:\\saida\\resultado.xlsx')
  mockApi({ exportResults })
  const found = foundItem()
  const notFound = notFoundItem()
  useStore.setState({ hasSearched: true, found: [found], notFound: [notFound] })
  render(<ResultsTable />)

  fireEvent.click(screen.getByRole('button', { name: /Exportar Excel/ }))

  await waitFor(() => expect(useStore.getState().toast).toBe('Exportado para C:\\saida\\resultado.xlsx'))
  expect(exportResults).toHaveBeenCalledWith([found, notFound], 'xlsx')
})

test('exportar não encontrados chama a API só com os não encontrados', async () => {
  const exportResults = vi.fn().mockResolvedValue('C:\\saida\\nao-encontrados.xlsx')
  mockApi({ exportResults })
  const notFound = notFoundItem()
  useStore.setState({ hasSearched: true, notFound: [notFound] })
  render(<ResultsTable />)

  fireEvent.click(screen.getByRole('button', { name: /Exportar não encontrados/ }))

  await waitFor(() =>
    expect(useStore.getState().toast).toBe('Não encontrados exportados para C:\\saida\\nao-encontrados.xlsx')
  )
  expect(exportResults).toHaveBeenCalledWith([notFound], 'xlsx')
})

test('falha ao exportar mostra um toast de erro em vez de travar silenciosamente', async () => {
  const exportResults = vi.fn().mockRejectedValue(new Error('disco cheio'))
  mockApi({ exportResults })
  useStore.setState({ hasSearched: true, found: [foundItem()] })
  render(<ResultsTable />)

  fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }))

  await waitFor(() => expect(useStore.getState().toast).toBe('Erro ao exportar: disco cheio'))
})
