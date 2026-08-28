import { create } from 'zustand'
import type {
  ArchiveDepthOption,
  FoundItem,
  NotFoundItem,
  ResultItem,
  ScanError,
  SearchStats
} from '@shared/types'

export type ResultFilter = 'todos' | 'encontrados' | 'nao_encontrados' | 'erros'
export type Theme = 'light' | 'dark'

function readInitialTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

const emptyStats: SearchStats = {
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
  hasSearched: boolean
  toast: string | null
  theme: Theme

  setRootFolder: (v: string | null) => void
  setIdentifiersRaw: (v: string) => void
  setMaxDepth: (v: ArchiveDepthOption) => void
  setFilter: (v: ResultFilter) => void
  setSelectedItem: (v: FoundItem | null) => void
  setShowHistory: (v: boolean) => void
  showToast: (msg: string) => void
  toggleTheme: () => void

  resetForNewSearch: () => void
  beginSearch: () => void
  applyProgress: (stats: SearchStats) => void
  applyFound: (item: FoundItem) => void
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
  hasSearched: false,
  toast: null,
  theme: readInitialTheme(),

  setRootFolder: (v) => set({ rootFolder: v }),
  setIdentifiersRaw: (v) => set({ identifiersRaw: v }),
  setMaxDepth: (v) => set({ maxDepth: v }),
  setFilter: (v) => set({ filter: v }),
  setSelectedItem: (v) => set({ selectedItem: v }),
  setShowHistory: (v) => set({ showHistory: v }),
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', next === 'dark')
    localStorage.setItem('xml-finder-theme', next)
    set({ theme: next })
  },
  showToast: (msg) => {
    set({ toast: msg })
    setTimeout(() => {
      if (get().toast === msg) set({ toast: null })
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

  applyFound: (item) =>
    set((s) => ({
      found: [...s.found, item],
      stats: { ...s.stats, foundCount: s.found.length + 1 }
    })),

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
      stats: { ...stats, phase: 'concluido' },
      searching: false,
      hasSearched: true,
      filter: 'todos',
      showHistory: false
    })
  }
}))
