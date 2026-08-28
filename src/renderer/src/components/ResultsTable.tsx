import { useMemo } from 'react'
import { useStore, type ResultFilter } from '../store'
import type { ResultItem } from '@shared/types'

const FILTERS: { value: ResultFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'encontrados', label: 'Encontrados' },
  { value: 'nao_encontrados', label: 'Não encontrados' },
  { value: 'erros', label: 'Erros' }
]

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function ResultsTable() {
  const found = useStore((s) => s.found)
  const notFound = useStore((s) => s.notFound)
  const errors = useStore((s) => s.errors)
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const setSelectedItem = useStore((s) => s.setSelectedItem)
  const hasSearched = useStore((s) => s.hasSearched)
  const searching = useStore((s) => s.searching)
  const showToast = useStore((s) => s.showToast)

  const allResults: ResultItem[] = useMemo(() => [...found, ...notFound], [found, notFound])

  const visible = useMemo(() => {
    if (filter === 'encontrados') return allResults.filter((r) => r.status === 'encontrado')
    if (filter === 'nao_encontrados') return allResults.filter((r) => r.status === 'nao_encontrado')
    if (filter === 'erros') return []
    return allResults
  }, [allResults, filter])

  async function handleExport(format: 'xlsx' | 'csv'): Promise<void> {
    const path = await window.api.exportResults(allResults, format)
    if (path) showToast(`Exportado para ${path}`)
  }

  async function handleExportNotFound(): Promise<void> {
    if (notFound.length === 0) return
    const path = await window.api.exportResults(notFound, 'xlsx')
    if (path) showToast(`Não encontrados exportados para ${path}`)
  }

  if (!hasSearched && !searching) {
    return (
      <div className="empty-state">
        <h3>Comece uma pesquisa</h3>
        <ol>
          <li>1. Selecione a pasta raiz</li>
          <li>2. Cole as chaves ou nomes de XML</li>
          <li>3. Clique em LOCALIZAR XMLs</li>
          <li>4. Acompanhe o progresso</li>
          <li>5. Veja encontrados e não encontrados</li>
          <li>6. Copie o caminho, abra a pasta ou extraia o XML</li>
        </ol>
      </div>
    )
  }

  return (
    <>
      <div className="toolbar">
        <div className="filter-tabs">
          {FILTERS.map((f) => (
            <div
              key={f.value}
              className={`filter-tab ${filter === f.value ? 'active' : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              {f.value === 'erros' && errors.length > 0 ? ` (${errors.length})` : ''}
            </div>
          ))}
        </div>
        <div className="toolbar-actions">
          <button className="btn sm" disabled={allResults.length === 0} onClick={() => handleExport('xlsx')}>
            ⬇ Exportar Excel
          </button>
          <button className="btn sm" disabled={allResults.length === 0} onClick={() => handleExport('csv')}>
            ⬇ Exportar CSV
          </button>
          <button className="btn sm" disabled={notFound.length === 0} onClick={handleExportNotFound}>
            ⬇ Exportar não encontrados
          </button>
        </div>
      </div>

      <div className="table-wrap">
        {filter === 'erros' ? (
          <ErrorsTable />
        ) : (
          <table className="results">
            <thead>
              <tr>
                <th>Status</th>
                <th>XML</th>
                <th>Chave</th>
                <th>Localização</th>
                <th>Tipo</th>
                <th>Tamanho</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => (item.status === 'encontrado' ? setSelectedItem(item) : undefined)}
                >
                  {item.status === 'encontrado' ? (
                    <>
                      <td>
                        <span className="badge found">Encontrado</span>
                      </td>
                      <td className="truncate mono">{item.fileName}</td>
                      <td className="mono truncate">{item.chave ?? '—'}</td>
                      <td className="truncate" title={item.location.diskPath}>
                        {item.location.chain.length > 0
                          ? `${basename(item.location.diskPath)} / ${item.location.chain.map((c) => basename(c.entryPath)).join(' / ')}`
                          : basename(item.location.diskPath)}
                      </td>
                      <td>
                        <span className="badge type">{item.storageType}</span>
                      </td>
                      <td>{fmtSize(item.sizeBytes)}</td>
                    </>
                  ) : (
                    <>
                      <td>
                        <span className="badge notfound">Não encontrado</span>
                      </td>
                      <td className="mono truncate">{item.identifier}</td>
                      <td className="mono truncate">—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function ErrorsTable() {
  const errors = useStore((s) => s.errors)
  return (
    <table className="results">
      <thead>
        <tr>
          <th>Tipo</th>
          <th>Caminho</th>
          <th>Mensagem</th>
        </tr>
      </thead>
      <tbody>
        {errors.map((e) => (
          <tr key={e.id}>
            <td>
              <span className="badge type">{e.kind}</span>
            </td>
            <td className="mono truncate" title={e.path}>
              {e.path}
            </td>
            <td className="truncate">{e.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}
