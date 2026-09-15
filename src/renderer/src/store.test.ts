import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FoundItem, NotFoundItem, ScanError, SearchStats } from '@shared/types'
import { LATEST_VERSION } from './changelog.ts'

/**
 * store.ts lê `document`/`localStorage` no MOMENTO em que o módulo é importado (tema e versão já
 * vista), não sob demanda — então esses globais precisam existir ANTES do import. Como não há DOM
 * de verdade rodando em `node --test`, cada teste instala um stub mínimo (sem jsdom nem nenhuma
 * dependência nova) e importa o módulo com uma query string diferente, só para furar o cache de
 * módulos ESM do Node e forçar a store a ser recriada do zero com o estado do stub daquele teste.
 */
function installDomStubs(initialDarkClass: boolean): { classes: Set<string>; storage: Map<string, string> } {
  const classes = new Set<string>(initialDarkClass ? ['dark'] : [])
  const storage = new Map<string, string>()

  ;(globalThis as Record<string, unknown>).document = {
    documentElement: {
      classList: {
        contains: (c: string) => classes.has(c),
        toggle: (c: string, force?: boolean) => {
          const shouldHave = force ?? !classes.has(c)
          if (shouldHave) classes.add(c)
          else classes.delete(c)
          return shouldHave
        }
      }
    }
  }
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => {
      storage.set(k, v)
    },
    removeItem: (k: string) => {
      storage.delete(k)
    }
  }

  return { classes, storage }
}

let importCounter = 0
async function freshStore(initialDarkClass = false) {
  const stubs = installDomStubs(initialDarkClass)
  importCounter++
  const mod = await import(`./store.ts?case=${importCounter}`)
  return { ...mod, stubs } as typeof mod & { stubs: ReturnType<typeof installDomStubs> }
}

function stats(overrides: Partial<SearchStats> = {}): SearchStats {
  return {
    filesScanned: 0,
    xmlAnalyzed: 0,
    zipCount: 0,
    rarCount: 0,
    foundCount: 0,
    notFoundCount: 0,
    errorCount: 0,
    elapsedMs: 0,
    estimatedTotal: 0,
    phase: 'concluido',
    ...overrides
  }
}

test('readInitialTheme: começa "light" quando a classe dark não está presente no documento', async () => {
  const { useStore } = await freshStore(false)
  assert.equal(useStore.getState().theme, 'light')
})

test('readInitialTheme: começa "dark" quando a classe dark já está presente no documento', async () => {
  const { useStore } = await freshStore(true)
  assert.equal(useStore.getState().theme, 'dark')
})

test('toggleTheme: alterna o tema, atualiza a classe do documento e persiste em localStorage', async () => {
  const { useStore, stubs } = await freshStore(false)

  useStore.getState().toggleTheme()
  assert.equal(useStore.getState().theme, 'dark')
  assert.ok(stubs.classes.has('dark'))
  assert.equal(stubs.storage.get('xml-finder-theme'), 'dark')

  useStore.getState().toggleTheme()
  assert.equal(useStore.getState().theme, 'light')
  assert.ok(!stubs.classes.has('dark'))
  assert.equal(stubs.storage.get('xml-finder-theme'), 'light')
})

test('setShowUpdates(true): grava a versão mais recente como vista e atualiza seenVersion no estado', async () => {
  const { useStore, stubs } = await freshStore(false)
  assert.equal(useStore.getState().seenVersion, null, 'nenhuma versão vista antes, localStorage vazio no stub')

  useStore.getState().setShowUpdates(true)

  assert.equal(useStore.getState().showUpdates, true)
  assert.equal(useStore.getState().seenVersion, LATEST_VERSION)
  assert.equal(stubs.storage.get('xml-finder-seen-version'), LATEST_VERSION)
})

test('seenVersion inicial vem de localStorage quando já havia uma versão vista antes do import', async () => {
  installDomStubs(false)
  ;((globalThis as Record<string, unknown>).localStorage as Storage).setItem('xml-finder-seen-version', '0.9.0')
  importCounter++
  const { useStore } = await import(`./store.ts?case=${importCounter}`)
  assert.equal(useStore.getState().seenVersion, '0.9.0')
})

test('resetForNewSearch: limpa resultados/erros/seleção anteriores e marca fase "buscando"', async () => {
  const { useStore } = await freshStore(false)
  const found: FoundItem = {
    id: '1',
    identifier: 'x',
    status: 'encontrado',
    fileName: 'a.xml',
    chave: null,
    docType: 'Desconhecido',
    location: { diskPath: '/a.xml', chain: [] },
    storageType: 'Pasta',
    matchMethod: 'nome',
    sizeBytes: 10,
    modifiedAt: null,
    emitCnpj: null,
    numero: null,
    serie: null,
    dataEmissao: null
  }
  useStore.setState({
    found: [found],
    notFound: [{ id: '2', identifier: 'y', status: 'nao_encontrado' }],
    errors: [{ id: '3', path: '/x', kind: 'desconhecido', message: 'erro' }],
    limitationNotes: ['nota'],
    filter: 'encontrados',
    selectedItem: found
  })

  useStore.getState().resetForNewSearch()

  const s = useStore.getState()
  assert.deepEqual(s.found, [])
  assert.deepEqual(s.notFound, [])
  assert.deepEqual(s.errors, [])
  assert.deepEqual(s.limitationNotes, [])
  assert.equal(s.filter, 'todos')
  assert.equal(s.selectedItem, null)
  assert.equal(s.stats.phase, 'buscando')
})

test('applyFoundBatch: acrescenta itens ao array existente, sem substituir o que já tinha', async () => {
  const { useStore } = await freshStore(false)
  const item = (id: string): FoundItem => ({
    id,
    identifier: id,
    status: 'encontrado',
    fileName: `${id}.xml`,
    chave: null,
    docType: 'Desconhecido',
    location: { diskPath: `/${id}.xml`, chain: [] },
    storageType: 'Pasta',
    matchMethod: 'nome',
    sizeBytes: 1,
    modifiedAt: null,
    emitCnpj: null,
    numero: null,
    serie: null,
    dataEmissao: null
  })

  useStore.getState().applyFoundBatch([item('a')])
  useStore.getState().applyFoundBatch([item('b'), item('c')])

  assert.deepEqual(
    useStore.getState().found.map((f) => f.id),
    ['a', 'b', 'c']
  )
})

test('applyFoundBatch: lote vazio não troca a referência do array found (evita render à toa)', async () => {
  const { useStore } = await freshStore(false)
  const before = useStore.getState().found
  useStore.getState().applyFoundBatch([])
  assert.equal(useStore.getState().found, before)
})

test('applyError: acumula erros em vez de substituir', async () => {
  const { useStore } = await freshStore(false)
  const err = (id: string): ScanError => ({ id, path: `/${id}`, kind: 'desconhecido', message: 'falhou' })

  useStore.getState().applyError(err('1'))
  useStore.getState().applyError(err('2'))

  assert.deepEqual(
    useStore.getState().errors.map((e) => e.id),
    ['1', '2']
  )
})

test('applyDone: marca searching=false e grava stats/notFound/limitationNotes recebidos', async () => {
  const { useStore } = await freshStore(false)
  useStore.setState({ searching: true })

  const notFound: NotFoundItem[] = [{ id: '1', identifier: 'x', status: 'nao_encontrado' }]
  useStore.getState().applyDone(stats({ phase: 'concluido', notFoundCount: 1 }), notFound, ['nota importante'])

  const s = useStore.getState()
  assert.equal(s.searching, false)
  assert.equal(s.stats.phase, 'concluido')
  assert.deepEqual(s.notFound, notFound)
  assert.deepEqual(s.limitationNotes, ['nota importante'])
})

test('loadFromHistory: separa found/notFound pelo status e reseta o resto do estado de exibição', async () => {
  const { useStore } = await freshStore(false)
  const found: FoundItem = {
    id: '1',
    identifier: 'x',
    status: 'encontrado',
    fileName: 'a.xml',
    chave: null,
    docType: 'Desconhecido',
    location: { diskPath: '/a.xml', chain: [] },
    storageType: 'Pasta',
    matchMethod: 'nome',
    sizeBytes: 1,
    modifiedAt: null,
    emitCnpj: null,
    numero: null,
    serie: null,
    dataEmissao: null
  }
  const notFound: NotFoundItem = { id: '2', identifier: 'y', status: 'nao_encontrado' }

  useStore.getState().loadFromHistory([found, notFound], stats(), '/pasta-antiga')

  const s = useStore.getState()
  assert.equal(s.rootFolder, '/pasta-antiga')
  assert.deepEqual(s.found, [found])
  assert.deepEqual(s.notFound, [notFound])
  assert.equal(s.searching, false)
  assert.equal(s.hasSearched, true)
  assert.equal(s.filter, 'todos')
  assert.equal(s.showHistory, false)
})

test('showToast: mostra a mensagem e some sozinho depois do tempo, sem apagar um toast mais novo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { useStore } = await freshStore(false)

  useStore.getState().showToast('primeiro')
  assert.equal(useStore.getState().toast, 'primeiro')

  t.mock.timers.tick(2400)
  assert.equal(useStore.getState().toast, null, 'some sozinho depois do tempo')

  useStore.getState().showToast('mais novo')
  t.mock.timers.tick(1000)
  useStore.getState().showToast('mais novo ainda') // token muda antes do primeiro timer disparar
  t.mock.timers.tick(1400) // chega ao instante em que o timer do toast ANTIGO dispararia (t=2400)
  assert.equal(
    useStore.getState().toast,
    'mais novo ainda',
    'o timer do toast antigo (token velho) não deve apagar o toast mais novo ainda visível'
  )
  t.mock.timers.tick(1000) // agora sim chega ao instante do timer do toast mais novo (t=3400)
  assert.equal(useStore.getState().toast, null, 'o timer do toast mais novo apaga normalmente no seu próprio prazo')
})
