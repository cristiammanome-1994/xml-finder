# Cobertura de teste para os 3 componentes React "untested hotspot" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar cobertura de teste de verdade (render real + interação do usuário) a `ResultsTable.tsx`, `ResultDetailDrawer.tsx` e `HistoryPanel.tsx` — os 3 "untested hotspots" apontados pelo Repowise — introduzindo Vitest + React Testing Library + jsdom como uma segunda trilha de testes ao lado do `node --test` já existente.

**Architecture:** O projeto hoje roda toda sua suíte (114 testes) com `node --test` puro, deliberadamente sem jsdom nem dependências novas (ver comentário em `src/renderer/src/store.test.ts:6-11`). Testar render real de componente React exige um DOM — impraticável só com stubs manuais. A solução é rodar Vitest como uma SEGUNDA trilha, isolada por extensão de arquivo (`*.test.tsx`, só dentro de `src/renderer/src/components/`), sem tocar nos 13 arquivos `*.test.ts` existentes nem no runner deles. `npm test` passa a rodar as duas trilhas em sequência.

**Tech Stack:** Vitest (test runner + assertions), @testing-library/react (render + queries), @testing-library/jest-dom (matchers `toBeInTheDocument`/`toHaveTextContent`/etc.), jsdom (ambiente DOM). `@vitejs/plugin-react` já é devDependency do projeto — reaproveitado, não instalado de novo.

**Spec:** Não há spec separado — este plano parte da decisão tomada em conversa com o usuário (confirmada via pergunta direta: "Vitest + RTL + jsdom") e da leitura direta dos 3 componentes-alvo e de tudo que eles importam (`store.ts`, `useEscapeKey.ts`, `format.ts`, `global.d.ts`, `preload/index.ts`, `shared/types.ts`).

## Global Constraints

- **Zero dependências novas em `dependencies`** — só em `devDependencies` (vitest, jsdom, @testing-library/react, @testing-library/jest-dom). Nada disso entra no bundle do app.
- **Não tocar nos 13 arquivos `*.test.ts` existentes nem no script `node --test`.** Eles continuam rodando exatamente como hoje.
- **Todo teste de componente novo usa extensão `.test.tsx` e vive em `src/renderer/src/components/`.** Confirmado empiricamente nesta sessão: `node --test` (Node v24.15.0, discovery default) NÃO pega arquivos `.test.tsx` — rodei uma sonda e a contagem de testes não mudou. Não é preciso mexer em nenhum glob do `node --test` existente.
- **O arquivo de setup do Vitest NÃO pode se chamar `test-*.ts`.** Confirmado empiricamente: um arquivo `test-setup.ts` FOI pego pelo discovery padrão do `node --test` (contagem subiu de 114 para 115) enquanto `vitest.setup.ts` não foi. Por isso o setup se chama `src/renderer/src/vitest.setup.ts`.
- **Cada arquivo de teste é autossuficiente** — duplica seus próprios helpers locais (`mockApi`, factories de item) em vez de importar de um módulo de test-utils compartilhado. Segue o estilo já usado em `store.test.ts` (que define seu próprio `stats()` local em vez de importar de algum lugar).
- **`npm run typecheck` tem um bug pré-existente e não relacionado a este plano:** `tsc --noEmit -p tsconfig.json` (modo "solution", `files: []` + `references`, sem `-b`) não desce para checar `tsconfig.web.json` — o lado renderer/web nunca é type-checado pelo script oficial hoje. Confirmado empiricamente: injetei um erro de tipo em `src/renderer/src/` e `npm run typecheck` passou limpo; rodando `npx tsc --noEmit -p tsconfig.web.json` direto, o mesmo erro aparece, junto com 5 erros pré-existentes não relacionados (import com extensão `.ts` sem `allowImportingTsExtensions`, `any` implícito em `store.test.ts`). Este plano NÃO corrige esse bug (fora de escopo), mas a Task 4 usa `npx tsc --noEmit -p tsconfig.web.json` diretamente (não o script quebrado) para validar os arquivos novos, comparando contra essa baseline de 5 erros pré-existentes.

---

## File Structure

- `vitest.config.ts` (novo, raiz do repo) — config do Vitest: ambiente jsdom, alias `@shared`, include restrito a `src/renderer/src/components/**/*.test.tsx`, setup file.
- `src/renderer/src/vitest.setup.ts` (novo) — importa os matchers do jest-dom e registra `cleanup()` global do RTL após cada teste.
- `src/renderer/src/components/ResultsTable.test.tsx` (novo)
- `src/renderer/src/components/ResultDetailDrawer.test.tsx` (novo)
- `src/renderer/src/components/HistoryPanel.test.tsx` (novo)
- `package.json` (modificado) — novas devDependencies, script `test` passa a rodar as duas trilhas.
- `README.md:198` (modificado) — a linha da tabela de scripts que descreve `npm test`.

---

### Task 1: Infra do Vitest + cobertura de ResultsTable.tsx

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/renderer/src/vitest.setup.ts`
- Create: `src/renderer/src/components/ResultsTable.test.tsx`
- Modify: `README.md:198`

**Interfaces:**
- Consumes: `useStore` de `src/renderer/src/store.ts` (campos `found`, `notFound`, `errors`, `filter`, `selectedItem`, `hasSearched`, `searching`, `toast`, `toastToken`); `ResultsTable` de `src/renderer/src/components/ResultsTable.tsx`; `window.api` tipado globalmente via `src/renderer/src/global.d.ts` (`Window['api']`).
- Produces: nada consumido por tasks depois — cada task é independente, mas as Tasks 2 e 3 dependem da infra (config + setup file) criada aqui já estar funcionando.

- [ ] **Step 1: Instalar as dependências de teste**

```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Criar `vitest.config.ts`**

```typescript
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/renderer/src/components/**/*.test.tsx'],
    setupFiles: ['src/renderer/src/vitest.setup.ts']
  }
})
```

- [ ] **Step 3: Criar `src/renderer/src/vitest.setup.ts`**

```typescript
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

afterEach(() => {
  cleanup()
})
```

- [ ] **Step 4: Criar `src/renderer/src/components/ResultsTable.test.tsx`**

```tsx
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

  expect(screen.getByText('nfe-1.xml')).toBeInTheDocument()
  expect(screen.getByText('nfe-1.xml').closest('tr')).toHaveTextContent('2.0 KB')
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
```

- [ ] **Step 5: Atualizar o script `test` em `package.json`**

Trocar:
```json
"test": "node --test",
```
por:
```json
"test": "node --test && vitest run",
```

- [ ] **Step 6: Atualizar `README.md:198`**

Trocar:
```markdown
| `npm test` | Roda a suíte de testes (`node --test`) da lógica pura do motor de busca |
```
por:
```markdown
| `npm test` | Roda a suíte de testes: `node --test` (motor de busca, main, store) + `vitest run` (componentes React) |
```

- [ ] **Step 7: Rodar só o arquivo novo e conferir que passa**

```bash
npx vitest run src/renderer/src/components/ResultsTable.test.tsx
```
Expected: todos os testes em verde, nenhum teste de `node --test` executado (vitest só olha para `*.test.tsx` dentro de `src/renderer/src/components/`).

- [ ] **Step 8: Rodar a suíte completa e conferir que as duas trilhas convivem**

```bash
npm test
```
Expected: a contagem de testes do `node --test` continua a mesma de antes (113 passam, 1 falha pré-existente e não relacionada em `history.test.ts` por causa de uma condição de corrida do Windows em rename de arquivo — não é deste plano), seguida pelos testes do Vitest, todos em verde.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/renderer/src/vitest.setup.ts src/renderer/src/components/ResultsTable.test.tsx README.md
git commit -m "Add Vitest + RTL + jsdom infra, cover ResultsTable.tsx"
```

---

### Task 2: Cobertura de ResultDetailDrawer.tsx

**Files:**
- Create: `src/renderer/src/components/ResultDetailDrawer.test.tsx`

**Interfaces:**
- Consumes: infra criada na Task 1 (`vitest.config.ts`, `vitest.setup.ts`); `useStore` (campo `selectedItem`, `toast`, `toastToken`); `ResultDetailDrawer` de `./ResultDetailDrawer.tsx`; `window.api` (`readXmlContent`, `openContainingFolder`, `selectDestinationFolder`, `extractSingle`); `navigator.clipboard.writeText` (stubado manualmente — jsdom não implementa a Clipboard API).

- [ ] **Step 1: Escrever `src/renderer/src/components/ResultDetailDrawer.test.tsx`**

```tsx
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
```

- [ ] **Step 2: Rodar e conferir que passa**

```bash
npx vitest run src/renderer/src/components/ResultDetailDrawer.test.tsx
```
Expected: todos em verde.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ResultDetailDrawer.test.tsx
git commit -m "Cover ResultDetailDrawer.tsx with Vitest + RTL"
```

---

### Task 3: Cobertura de HistoryPanel.tsx

**Files:**
- Create: `src/renderer/src/components/HistoryPanel.test.tsx`

**Interfaces:**
- Consumes: infra da Task 1; `useStore` e `emptyStats` de `../store`; `HistoryPanel` de `./HistoryPanel.tsx`; `window.api` (`listHistory`, `clearHistory`, `clearSearchIndex`).

- [ ] **Step 1: Escrever `src/renderer/src/components/HistoryPanel.test.tsx`**

```tsx
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
```

- [ ] **Step 2: Rodar e conferir que passa**

```bash
npx vitest run src/renderer/src/components/HistoryPanel.test.tsx
```
Expected: todos em verde.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/HistoryPanel.test.tsx
git commit -m "Cover HistoryPanel.tsx with Vitest + RTL"
```

---

### Task 4: Verificação final

Sem arquivos novos — só confirma que tudo se encaixa antes de considerar a rodada fechada.

- [ ] **Step 1: Rodar a suíte inteira (as duas trilhas)**

```bash
npm test
```
Expected: `node --test` com a mesma contagem/resultado de antes (113 passam, 1 falha pré-existente e não relacionada em `history.test.ts:88` — condição de corrida de `rename` no Windows, não é deste plano), seguido por todos os testes do Vitest em verde.

- [ ] **Step 2: Checar os arquivos novos contra o `tsc` direto (não o script `npm run typecheck`, que tem o bug descrito nas Global Constraints)**

```bash
npx tsc --noEmit -p tsconfig.web.json
```
Expected: os mesmos 5 erros pré-existentes de antes deste plano (não relacionados: extensão `.ts` em import sem `allowImportingTsExtensions`, `any` implícito em `store.test.ts`) — e nenhum erro novo vindo de `ResultsTable.test.tsx`, `ResultDetailDrawer.test.tsx`, `HistoryPanel.test.tsx` ou `vitest.setup.ts`. Se aparecer erro novo, corrigir antes de seguir.

- [ ] **Step 3: Repowise — conferir que os 3 arquivos saíram da lista de "untested hotspot"**

Rodar `get_health()` (ferramenta MCP do Repowise) e confirmar que `ResultsTable.tsx`, `ResultDetailDrawer.tsx` e `HistoryPanel.tsx` não aparecem mais como "untested hotspot" na lista de arquivos críticos.

---

## Self-Review

- **Cobertura do objetivo:** os 3 componentes-alvo (`ResultsTable`, `ResultDetailDrawer`, `HistoryPanel`) têm uma task dedicada cada um; a infra (Task 1) é o único pré-requisito compartilhado.
- **Placeholders:** nenhum — todo bloco de código é o conteúdo final do arquivo, sem "TODO" nem trechos resumidos.
- **Consistência de tipos:** os três arquivos de teste usam a mesma forma de `mockApi()` (batendo com `Window['api']` de `global.d.ts`) e as mesmas factories de item (`foundItem`/`notFoundItem`/`scanError`/`historyEntry`) construídas a partir dos campos reais de `@shared/types`, conferidos linha a linha contra `src/shared/types.ts`.
- **Risco verificado empiricamente, não assumido:** tanto a exclusão de `.test.tsx` do discovery do `node --test` quanto a armadilha do nome `test-setup.ts` foram testadas rodando o comando de verdade nesta sessão, não deduzidas da documentação.
