import type { SearchOptions } from '@shared/types'
// Extensão .ts explícita (em vez do padrão dos outros arquivos de engine) porque este módulo
// também é carregado diretamente pelo runner de testes do Node, cujo resolvedor ESM exige o
// especificador exato do arquivo — o bundler de produção (Vite) aceita o mesmo especificador
// (mesmo raciocínio documentado em extractor.ts).
import { SearchRun, buildLocation, storageTypeFor, resolveEntryKind } from './searchRun.ts'
import type { SearchHooks, SearchResult } from './searchRun.ts'

// A orquestração com estado de uma busca (antes ~15 funções aninhadas fechando sobre as mesmas
// variáveis por closure) vive em SearchRun (./searchRun.ts), testável isoladamente por método.
// Este arquivo permanece o ponto de entrada público do engine — runSearch — e reexporta os
// helpers puros que searchEngine.test.ts (e outros consumidores) já dependem encontrar aqui.
export type { SearchHooks, SearchResult }
export { buildLocation, storageTypeFor, resolveEntryKind }

export async function runSearch(options: SearchOptions, hooks: SearchHooks): Promise<SearchResult> {
  return new SearchRun(options, hooks).execute()
}
