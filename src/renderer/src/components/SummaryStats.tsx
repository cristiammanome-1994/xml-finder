import { useMemo } from 'react'
import { useStore } from '../store'

export function SummaryStats() {
  const found = useStore((s) => s.found)
  const notFound = useStore((s) => s.notFound)
  const errors = useStore((s) => s.errors)
  const hasSearched = useStore((s) => s.hasSearched)

  const breakdown = useMemo(() => {
    let zip = 0
    let rar = 0
    let folder = 0
    for (const f of found) {
      if (f.storageType === 'ZIP') zip++
      else if (f.storageType === 'RAR') rar++
      else folder++
    }
    return { zip, rar, folder }
  }, [found])

  if (!hasSearched) return null

  const total = found.length + notFound.length

  return (
    <div className="summary-bar">
      <div className="summary-chip">
        <div className="num">{total.toLocaleString('pt-BR')}</div>
        <div className="label">Pesquisados</div>
      </div>
      <div className="summary-chip found">
        <div className="num">{found.length.toLocaleString('pt-BR')}</div>
        <div className="label">Encontrados</div>
      </div>
      <div className="summary-chip notfound">
        <div className="num">{notFound.length.toLocaleString('pt-BR')}</div>
        <div className="label">Não encontrados</div>
      </div>
      <div className="summary-chip">
        <div className="num">{breakdown.zip.toLocaleString('pt-BR')}</div>
        <div className="label">Dentro de ZIP</div>
      </div>
      <div className="summary-chip">
        <div className="num">{breakdown.rar.toLocaleString('pt-BR')}</div>
        <div className="label">Dentro de RAR</div>
      </div>
      <div className="summary-chip">
        <div className="num">{breakdown.folder.toLocaleString('pt-BR')}</div>
        <div className="label">Em pastas</div>
      </div>
      {errors.length > 0 && (
        <div className="summary-chip errors">
          <div className="num">{errors.length.toLocaleString('pt-BR')}</div>
          <div className="label">Erros</div>
        </div>
      )}
    </div>
  )
}
