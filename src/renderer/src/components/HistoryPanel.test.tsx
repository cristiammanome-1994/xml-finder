import { beforeEach, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { emptyStats, useStore } from '../store'
import { HistoryPanel } from './HistoryPanel'
import type { HistoryEntry } from '@shared/types'

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
    listHistory: vi.fn().mockResolvedValue([]),
    appendHistory: vi.fn(),
    clearHistory: vi.fn().mockResolvedValue(undefined),
    clearSearchIndex: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

function historyEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'h1',
    date: Date.parse('2026-01-10T12:00:00Z'),
    rootFolder: 'C:\\pasta\\notas',
    totalIdentifiers: 10,
    found: 7,
    notFound: 3,
    elapsedMs: 65000,
    results: [],
    cancelled: false,
    ...overrides
  }
}

const realLoadFromHistory = useStore.getState().loadFromHistory

beforeEach(() => {
  useStore.setState({ showHistory: false, toast: null, toastToken: 0, loadFromHistory: realLoadFromHistory })
  mockApi()
})

test('showHistory false: não renderiza nada e não consulta o histórico', () => {
  render(<HistoryPanel />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(window.api.listHistory).not.toHaveBeenCalled()
})

test('showHistory true, sem entradas: mostra a mensagem de histórico vazio', async () => {
  useStore.setState({ showHistory: true })
  render(<HistoryPanel />)

  expect(await screen.findByText('Nenhuma pesquisa salva ainda.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Limpar histórico' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Limpar índice de pesquisa' })).toBeInTheDocument()
})

test('lista as entradas com pasta, contadores e tempo formatados', async () => {
  mockApi({
    listHistory: vi
      .fn()
      .mockResolvedValue([
        historyEntry({ rootFolder: 'C:\\pasta\\notas', found: 7, notFound: 3, totalIdentifiers: 10, elapsedMs: 65000 })
      ])
  })
  useStore.setState({ showHistory: true })
  render(<HistoryPanel />)

  expect(await screen.findByText('C:\\pasta\\notas')).toBeInTheDocument()
  expect(screen.getByText('10 pesquisados')).toBeInTheDocument()
  expect(screen.getByText('7 encontrados')).toBeInTheDocument()
  expect(screen.getByText('3 não encontrados')).toBeInTheDocument()
  expect(screen.getByText('01:05')).toBeInTheDocument()
})

test('entrada cancelada mostra o selo "Cancelada — incompleta"', async () => {
  mockApi({ listHistory: vi.fn().mockResolvedValue([historyEntry({ cancelled: true })]) })
  useStore.setState({ showHistory: true })
  render(<HistoryPanel />)

  expect(await screen.findByText('Cancelada — incompleta')).toBeInTheDocument()
})

test('clicar numa entrada chama loadFromHistory com os resultados e as estatísticas derivadas da entrada', async () => {
  const entry = historyEntry({
    cancelled: false,
    found: 7,
    notFound: 3,
    totalIdentifiers: 10,
    elapsedMs: 65000,
    rootFolder: 'C:\\pasta\\notas'
  })
  mockApi({ listHistory: vi.fn().mockResolvedValue([entry]) })
  const loadFromHistory = vi.fn()
  useStore.setState({ showHistory: true, loadFromHistory })
  render(<HistoryPanel />)

  const row = await screen.findByText('C:\\pasta\\notas')
  fireEvent.click(row.closest('[role="button"]')!)

  expect(loadFromHistory).toHaveBeenCalledWith(
    entry.results,
    {
      ...emptyStats,
      foundCount: 7,
      notFoundCount: 3,
      elapsedMs: 65000,
      estimatedTotal: 10,
      phase: 'concluido'
    },
    'C:\\pasta\\notas'
  )
})

test('entrada cancelada reabre com phase "cancelado"', async () => {
  const entry = historyEntry({ cancelled: true })
  mockApi({ listHistory: vi.fn().mockResolvedValue([entry]) })
  const loadFromHistory = vi.fn()
  useStore.setState({ showHistory: true, loadFromHistory })
  render(<HistoryPanel />)

  const row = await screen.findByText(entry.rootFolder)
  fireEvent.keyDown(row.closest('[role="button"]')!, { key: 'Enter' })

  expect(loadFromHistory).toHaveBeenCalledWith(
    entry.results,
    expect.objectContaining({ phase: 'cancelado' }),
    entry.rootFolder
  )
})

test('Limpar histórico chama a API e esvazia a lista na tela', async () => {
  const clearHistory = vi.fn().mockResolvedValue(undefined)
  mockApi({ listHistory: vi.fn().mockResolvedValue([historyEntry()]), clearHistory })
  useStore.setState({ showHistory: true })
  render(<HistoryPanel />)

  await screen.findByText('C:\\pasta\\notas')
  fireEvent.click(screen.getByRole('button', { name: 'Limpar histórico' }))

  expect(await screen.findByText('Nenhuma pesquisa salva ainda.')).toBeInTheDocument()
  expect(clearHistory).toHaveBeenCalled()
})

test('Limpar índice de pesquisa chama a API e mostra um toast de confirmação', async () => {
  const clearSearchIndex = vi.fn().mockResolvedValue(undefined)
  mockApi({ clearSearchIndex })
  useStore.setState({ showHistory: true })
  render(<HistoryPanel />)

  await screen.findByText('Nenhuma pesquisa salva ainda.')
  fireEvent.click(screen.getByRole('button', { name: 'Limpar índice de pesquisa' }))

  await waitFor(() => expect(useStore.getState().toast).toBe('Índice de pesquisa limpo'))
  expect(clearSearchIndex).toHaveBeenCalled()
})

test('Esc fecha o painel', async () => {
  useStore.setState({ showHistory: true })
  render(<HistoryPanel />)
  await screen.findByText('Nenhuma pesquisa salva ainda.')

  fireEvent.keyDown(window, { key: 'Escape' })
  expect(useStore.getState().showHistory).toBe(false)
})

test('clicar fora (overlay) fecha o painel', async () => {
  useStore.setState({ showHistory: true })
  render(<HistoryPanel />)
  await screen.findByText('Nenhuma pesquisa salva ainda.')

  fireEvent.click(screen.getByRole('dialog').parentElement!)
  expect(useStore.getState().showHistory).toBe(false)
})
