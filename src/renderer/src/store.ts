import { create } from 'zustand'
import type {
  ArchiveDepthOption,
  FoundItem,
  NotFoundItem,
  ResultItem,
  ScanError,
  SearchStats
} from '@shared/types'
import { LATEST_VERSION } from './changelog'

export type ResultFilter = 'todos' | 'encontrados' | 'nao_encontrados' | 'erros'
export type Theme = 'light' | 'dark'

const SEEN_VERSION_KEY = 'xml-finder-seen-version'

function readInitialTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function readSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_VERSION_KEY)
  } catch {
    return null
  }
}

export const emptyStats: SearchStats = {
  filesScanned: 0,
  xmlAnalyzed: 0,
  zipCount: 0,
  rarCount: 0,
  foundCount: 0,
  notFoundCount: 0,
  errorCount: 0,
  elapsedMs: 0,
  estimatedTotal: 0,
  phase: 'concluido'
}

interface State {
  rootFolder: string | null
  identifiersRaw: string
  maxDepth: ArchiveDepthOption
  searching: boolean
  stats: SearchStats
  found: FoundItem[]
  notFound: NotFoundItem[]
  errors: ScanError[]
  limitationNotes: string[]
  filter: ResultFilter
  selectedItem: FoundItem | null
  showHistory: boolean
  showUpdates: boolean
  seenVersion: string | null
  hasSearched: boolean
  toast: string | null
  toastToken: number
  theme: Theme

  setRootFolder: (v: string | null) => void
  setIdentifiersRaw: (v: string) => void
  setMaxDepth: (v: ArchiveDepthOption) => void
  setFilter: (v: ResultFilter) => void
  setSelectedItem: (v: FoundItem | null) => void
  setShowHistory: (v: boolean) => void
  setShowUpdates: (v: boolean) => void
  showToast: (msg: string) => void
  toggleTheme: () => void

  resetForNewSearch: () => void
  beginSearch: () => void
  applyProgress: (stats: SearchStats) => void
  applyFoundBatch: (items: FoundItem[]) => void
  applyError: (error: ScanError) => void
  applyDone: (stats: SearchStats, notFound: NotFoundItem[], notes: string[]) => void
  loadFromHistory: (results: ResultItem[], stats: SearchStats, rootFolder: string) => void
}

export const useStore = create<State>((set, get) => ({
  rootFolder: null,
  identifiersRaw: '',
  maxDepth: 3,
  searching: false,
  stats: emptyStats,
  found: [],
  notFound: [],
  errors: [],
  limitationNotes: [],
  filter: 'todos',
  selectedItem: null,
  showHistory: false,
  showUpdates: false,
  seenVersion: readSeenVersion(),
  hasSearched: false,
  toast: null,
  toastToken: 0,
  theme: readInitialTheme(),

  setRootFolder: (v) => set({ rootFolder: v }),
  setIdentifiersRaw: (v) => set({ identifiersRaw: v }),
  setMaxDepth: (v) => set({ maxDepth: v }),
  setFilter: (v) => set({ filter: v }),
  setSelectedItem: (v) => set({ selectedItem: v }),
  setShowHistory: (v) => set({ showHistory: v }),
  setShowUpdates: (v) => {
    set({ showUpdates: v })
    if (v && LATEST_VERSION) {
      try {
        localStorage.setItem(SEEN_VERSION_KEY, LATEST_VERSION)
      } catch {
        // localStorage indisponível — o indicador de "não visto" só não persiste entre sessões
      }
      set({ seenVersion: LATEST_VERSION })
    }
  },
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', next === 'dark')
    localStorage.setItem('xml-finder-theme', next)
    set({ theme: next })
  },
  showToast: (msg) => {
    const token = get().toastToken + 1
    set({ toast: msg, toastToken: token })
    setTimeout(() => {
      if (get().toastToken === token) set({ toast: null })
    }, 2400)
  },

  resetForNewSearch: () =>
    set({
      found: [],
      notFound: [],
      errors: [],
      limitationNotes: [],
      filter: 'todos',
      selectedItem: null,
      stats: { ...emptyStats, phase: 'buscando' }
    }),

  beginSearch: () => set({ searching: true, hasSearched: true }),

  applyProgress: (stats) => set({ stats }),

  // Recebe os resultados em lote (ver o buffer em App.tsx): copiar o array a cada item
  // encontrado é O(n²) e dispara um render da tabela por item — inviável numa pesquisa que
  // localiza milhares de XMLs.
  //
  // stats.foundCount não é recomputado aqui — o worker sempre manda um 'progress' logo após
  // cada 'found', então stats fica correto no próximo applyProgress em vez de ter duas fontes
  // de verdade para a mesma contagem.
  applyFoundBatch: (items) =>
    set((s) => (items.length === 0 ? s : { found: [...s.found, ...items] })),

  applyError: (error) => set((s) => ({ errors: [...s.errors, error] })),

  applyDone: (stats, notFound, notes) =>
    set({ searching: false, stats, notFound, limitationNotes: notes }),

  loadFromHistory: (results, stats, rootFolder) => {
    const found = results.filter((r): r is FoundItem => r.status === 'encontrado')
    const notFound = results.filter((r): r is NotFoundItem => r.status === 'nao_encontrado')
    set({
      rootFolder,
      found,
      notFound,
      errors: [],
      limitationNotes: [],
      stats,
      searching: false,
      hasSearched: true,
      filter: 'todos',
      showHistory: false
    })
  }
}))
