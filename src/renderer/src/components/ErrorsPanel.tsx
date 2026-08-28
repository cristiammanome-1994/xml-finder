import { useState } from 'react'
import { useStore } from '../store'

const KIND_LABEL: Record<string, string> = {
  zip_corrompido: 'ZIP corrompido',
  rar_corrompido: 'RAR corrompido',
  xml_invalido: 'XML inválido/malformado',
  senha_protegida: 'Protegido por senha',
  sem_permissao: 'Sem permissão de leitura',
  encoding: 'Problema de encoding',
  desconhecido: 'Erro desconhecido'
}

export function ErrorsPanel() {
  const errors = useStore((s) => s.errors)
  const limitationNotes = useStore((s) => s.limitationNotes)
  const [open, setOpen] = useState(false)

  if (errors.length === 0 && limitationNotes.length === 0) return null

  return (
    <>
      {errors.length > 0 && (
        <div className="errors-banner" onClick={() => setOpen(true)}>
          <span>
            ⚠ {errors.length} {errors.length === 1 ? 'arquivo não pôde' : 'arquivos não puderam'} ser analisado(s).
          </span>
          <span>Ver detalhes →</span>
        </div>
      )}
      {open && (
        <div className="overlay centered" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <strong>Erros e limitações da pesquisa</strong>
              <button className="close-btn" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              {limitationNotes.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div className="detail-label">Limitações</div>
                  {limitationNotes.map((n, i) => (
                    <div key={i} className="key-hint invalid" style={{ marginTop: 6 }}>
                      ⚠ {n}
                    </div>
                  ))}
                </div>
              )}
              {errors.map((err) => (
                <div key={err.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="badge type">{KIND_LABEL[err.kind] ?? err.kind}</span>
                  </div>
                  <div className="mono" style={{ marginTop: 6, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                    {err.path}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12 }}>{err.message}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
