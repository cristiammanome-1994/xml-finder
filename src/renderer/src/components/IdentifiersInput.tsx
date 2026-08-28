import { useMemo } from 'react'
import { CheckCircle2, AlertTriangle, Type } from 'lucide-react'
import { useStore } from '../store'
import { parseIdentifierList, isLikelyAccessKey, validateAccessKey } from '@shared/keyUtils'

export function IdentifiersInput() {
  const identifiersRaw = useStore((s) => s.identifiersRaw)
  const setIdentifiersRaw = useStore((s) => s.setIdentifiersRaw)
  const searching = useStore((s) => s.searching)

  const analysis = useMemo(() => {
    const items = parseIdentifierList(identifiersRaw)
    let validKeys = 0
    let invalidKeys = 0
    let byName = 0
    for (const item of items) {
      if (isLikelyAccessKey(item)) {
        validateAccessKey(item).valid ? validKeys++ : invalidKeys++
      } else {
        byName++
      }
    }
    return { total: items.length, validKeys, invalidKeys, byName }
  }, [identifiersRaw])

  return (
    <div className="card">
      <span className="section-label">XMLs ou chaves para localizar</span>
      <textarea
        placeholder={
          'Cole uma ou várias chaves de acesso (44 dígitos), nomes de arquivo ou trechos do nome.\n\nUma por linha, ou separadas por espaço/vírgula:\n\n35260812345678000123550010000012341000012345\nNF001.xml'
        }
        value={identifiersRaw}
        onChange={(e) => setIdentifiersRaw(e.target.value)}
        disabled={searching}
      />
      <div className="identifiers-counter">
        <span>
          <b>{analysis.total}</b> {analysis.total === 1 ? 'XML informado' : 'XMLs informados'}
        </span>
      </div>
      {analysis.total > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {analysis.validKeys > 0 && (
            <div className="key-hint valid">
              <CheckCircle2 className="icon" style={{ width: 13, height: 13 }} />
              {analysis.validKeys} chave(s) de acesso válida(s)
            </div>
          )}
          {analysis.invalidKeys > 0 && (
            <div className="key-hint invalid">
              <AlertTriangle className="icon" style={{ width: 13, height: 13 }} />
              {analysis.invalidKeys} chave(s) com dígito verificador inválido
            </div>
          )}
          {analysis.byName > 0 && (
            <div className="key-hint" style={{ color: 'var(--muted-foreground)' }}>
              <Type className="icon" style={{ width: 13, height: 13 }} />
              {analysis.byName} identificador(es) por nome de arquivo
            </div>
          )}
        </div>
      )}
    </div>
  )
}
