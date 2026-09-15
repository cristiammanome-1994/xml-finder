import { beforeEach, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useStore } from '../store'
import { ResultDetailDrawer } from './ResultDetailDrawer'
import type { FoundItem } from '@shared/types'

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

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  useStore.setState({ selectedItem: null, toast: null, toastToken: 0 })
  mockApi()
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true
  })
})

test('sem item selecionado, não renderiza nada', () => {
  render(<ResultDetailDrawer />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('com item selecionado, mostra os campos básicos e esconde os grupos opcionais ausentes', () => {
  useStore.setState({ selectedItem: foundItem() })
  render(<ResultDetailDrawer />)

  expect(screen.getByRole('dialog', { name: 'Detalhes do XML' })).toBeInTheDocument()
  expect(screen.getByText('nfe-1.xml')).toBeInTheDocument()
  expect(screen.getByText('35200114200166000166550010000000015123456789')).toBeInTheDocument()
  expect(screen.getByText('NFe')).toBeInTheDocument()
  expect(screen.getByText('C:\\pasta\\nfe-1.xml')).toBeInTheDocument()
  expect(screen.getByText('2.0 KB')).toBeInTheDocument()

  expect(screen.queryByText('Número / Série')).not.toBeInTheDocument()
  expect(screen.queryByText('CNPJ do emitente')).not.toBeInTheDocument()
  expect(screen.queryByText('Data de emissão')).not.toBeInTheDocument()
  expect(screen.queryByText('Caminho interno')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Copiar caminho completo' })).not.toBeInTheDocument()
})

test('mostra número/série, CNPJ e data de emissão quando presentes', () => {
  useStore.setState({
    selectedItem: foundItem({ numero: '15', serie: '1', emitCnpj: '11222333000181', dataEmissao: '2026-01-05' })
  })
  render(<ResultDetailDrawer />)

  expect(screen.getByText('15 / 1')).toBeInTheDocument()
  expect(screen.getByText('11222333000181')).toBeInTheDocument()
  expect(screen.getByText('2026-01-05')).toBeInTheDocument()
})

test('matchMethod "nome" é rotulado como "Nome do arquivo"', () => {
  useStore.setState({ selectedItem: foundItem({ matchMethod: 'nome' }) })
  render(<ResultDetailDrawer />)
  expect(screen.getByText('Localizado por').nextElementSibling).toHaveTextContent('Nome do arquivo')
})

test('matchMethod "indice" é rotulado como "Índice (pesquisa anterior nesta pasta)"', () => {
  useStore.setState({ selectedItem: foundItem({ matchMethod: 'indice' }) })
  render(<ResultDetailDrawer />)
  expect(screen.getByText('Localizado por').nextElementSibling).toHaveTextContent(
    'Índice (pesquisa anterior nesta pasta)'
  )
})

test('matchMethod "conteudo" é rotulado como "Conteúdo do XML"', () => {
  useStore.setState({ selectedItem: foundItem({ matchMethod: 'conteudo' }) })
  render(<ResultDetailDrawer />)
  expect(screen.getByText('Localizado por').nextElementSibling).toHaveTextContent('Conteúdo do XML')
})

test('item dentro de ZIP mostra caminho interno e sufixo de arquivo no tipo de armazenamento', () => {
  useStore.setState({
    selectedItem: foundItem({
      storageType: 'ZIP',
      location: {
        diskPath: 'C:\\pasta\\lote.zip',
        chain: [{ containerType: 'zip', entryPath: 'notas/nfe-1.xml' }]
      }
    })
  })
  render(<ResultDetailDrawer />)

  expect(screen.getByText('Caminho interno')).toBeInTheDocument()
  expect(screen.getByText('notas/nfe-1.xml')).toBeInTheDocument()
  expect(screen.getByText('ZIP (arquivo: lote.zip)')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copiar caminho completo' })).toBeInTheDocument()
})

test('botão de fechar (X) limpa o item selecionado', () => {
  useStore.setState({ selectedItem: foundItem() })
  render(<ResultDetailDrawer />)

  fireEvent.click(screen.getByRole('button', { name: 'Fechar detalhes' }))
  expect(useStore.getState().selectedItem).toBeNull()
})

test('clicar fora (overlay) fecha; clicar dentro do conteúdo não fecha', () => {
  useStore.setState({ selectedItem: foundItem() })
  render(<ResultDetailDrawer />)

  fireEvent.click(screen.getByText('Detalhes do XML'))
  expect(useStore.getState().selectedItem).not.toBeNull()

  fireEvent.click(screen.getByRole('dialog'))
  expect(useStore.getState().selectedItem).not.toBeNull()

  fireEvent.click(screen.getByRole('dialog').parentElement!)
  expect(useStore.getState().selectedItem).toBeNull()
})

test('Esc fecha o drawer quando o visualizador de XML não está aberto', () => {
  useStore.setState({ selectedItem: foundItem() })
  render(<ResultDetailDrawer />)

  fireEvent.keyDown(window, { key: 'Escape' })
  expect(useStore.getState().selectedItem).toBeNull()
})

test('com o visualizador de XML aberto, Esc fecha só o visualizador, e um segundo Esc fecha o drawer', async () => {
  const readXmlContent = vi.fn().mockResolvedValue('<a><b/></a>')
  mockApi({ readXmlContent })
  useStore.setState({ selectedItem: foundItem() })
  render(<ResultDetailDrawer />)

  fireEvent.click(screen.getByRole('button', { name: 'Visualizar XML' }))
  await screen.findByRole('dialog', { name: 'Conteúdo de nfe-1.xml' })

  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Conteúdo de nfe-1.xml' })).not.toBeInTheDocument()
  )
  expect(useStore.getState().selectedItem).not.toBeNull()

  fireEvent.keyDown(window, { key: 'Escape' })
  expect(useStore.getState().selectedItem).toBeNull()
})

test('copiar caminho: sucesso mostra toast e chama a clipboard com o caminho em disco', async () => {
  useStore.setState({ selectedItem: foundItem() })
  render(<ResultDetailDrawer />)

  fireEvent.click(screen.getByRole('button', { name: 'Copiar caminho' }))

  await waitFor(() => expect(useStore.getState().toast).toBe('Caminho copiado'))
  expect(writeText).toHaveBeenCalledWith('C:\\pasta\\nfe-1.xml')
})

test('copiar caminho: falha mostra toast de erro com a mensagem original', async () => {
  writeText.mockRejectedValueOnce(new Error('clipboard indisponível'))
  useStore.setState({ selectedItem: foundItem() })
  render(<ResultDetailDrawer />)

  fireEvent.click(screen.getByRole('button', { name: 'Copiar caminho' }))

  await waitFor(() => expect(useStore.getState().toast).toBe('Erro ao copiar caminho: clipboard indisponível'))
})

test('copiar caminho completo inclui o caminho interno do arquivo compactado', async () => {
  useStore.setState({
    selectedItem: foundItem({
      location: {
        diskPath: 'C:\\pasta\\lote.zip',
        chain: [{ containerType: 'zip', entryPath: 'notas/nfe-1.xml' }]
      }
    })
  })
  render(<ResultDetailDrawer />)

  fireEvent.click(screen.getByRole('button', { name: 'Copiar caminho completo' }))

  await waitFor(() => expect(useStore.getState().toast).toBe('Caminho completo copiado'))
  expect(writeText).toHaveBeenCalledWith('C:\\pasta\\lote.zip\n→ notas/nfe-1.xml')
})

test('abrir pasta chama a API com o caminho em disco e não mostra toast quando dá certo', async () => {
  const openContainingFolder = vi.fn().mockResolvedValue(undefined)
  mockApi({ openContainingFolder })
  useStore.setState({ selectedItem: foundItem() })
  render(<ResultDetailDrawer />)

  fireEvent.click(screen.getByRole('button', { name: 'Abrir pasta' }))

  await waitFor(() => expect(openContainingFolder).toHaveBeenCalledWith('C:\\pasta\\nfe-1.xml'))
  expect(useStore.getState().toast).toBeNull()
})

test('abrir pasta: falha mostra toast de erro', async () => {
  mockApi({ openContainingFolder: vi.fn().mockRejectedValue(new Error('pasta não existe mais')) })
  useStore.setState({ selectedItem: foundItem() })
  render(<ResultDetailDrawer />)

  fireEvent.click(screen.getByRole('button', { name: 'Abrir pasta' }))

  await waitFor(() => expect(useStore.getState().toast).toBe('Erro ao abrir pasta: pasta não existe mais'))
})

test('extrair XML: usuário cancela a escolha de pasta e nada é extraído', async () => {
  const selectDestinationFolder = vi.fn().mockResolvedValue(null)
  const extractSingle = vi.fn()
  mockApi({ selectDestinationFolder, extractSingle })
  useStore.setState({ selectedItem: foundItem() })
  render(<ResultDetailDrawer />)

  fireEvent.click(screen.getByRole('button', { name: 'Extrair XML' }))

  await waitFor(() => expect(selectDestinationFolder).toHaveBeenCalled())
  expect(extractSingle).not.toHaveBeenCalled()
  expect(useStore.getState().toast).toBeNull()
})

test('extrair XML: sucesso chama a API com o destino escolhido e mostra o caminho salvo', async () => {
  const item = foundItem()
  const selectDestinationFolder = vi.fn().mockResolvedValue('C:\\destino')
  const extractSingle = vi.fn().mockResolvedValue('C:\\destino\\nfe-1.xml')
  mockApi({ selectDestinationFolder, extractSingle })
  useStore.setState({ selectedItem: item })
  render(<ResultDetailDrawer />)

  fireEvent.click(screen.getByRole('button', { name: 'Extrair XML' }))

  await waitFor(() => expect(useStore.getState().toast).toBe('XML extraído para C:\\destino\\nfe-1.xml'))
  expect(extractSingle).toHaveBeenCalledWith({
    location: item.location,
    fileName: item.fileName,
    destinationFolder: 'C:\\destino'
  })
})

test('extrair XML: falha na extração mostra toast de erro', async () => {
  mockApi({
    selectDestinationFolder: vi.fn().mockResolvedValue('C:\\destino'),
    extractSingle: vi.fn().mockRejectedValue(new Error('sem espaço em disco'))
  })
  useStore.setState({ selectedItem: foundItem() })
  render(<ResultDetailDrawer />)

  fireEvent.click(screen.getByRole('button', { name: 'Extrair XML' }))

  await waitFor(() => expect(useStore.getState().toast).toBe('Erro ao extrair XML: sem espaço em disco'))
})
