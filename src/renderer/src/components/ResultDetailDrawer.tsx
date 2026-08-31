import { useState } from 'react'
import { Clipboard, ClipboardList, FolderOpen, Save, Eye, X } from 'lucide-react'
import { useStore } from '../store'
import { fmtSize, basename } from '../format'
import { XmlViewerModal } from './XmlViewerModal'

export function ResultDetailDrawer() {
  const item = useStore((s) => s.selectedItem)
  const setSelectedItem = useStore((s) => s.setSelectedItem)
  const showToast = useStore((s) => s.showToast)
  const [xmlViewerOpen, setXmlViewerOpen] = useState(false)

  if (!item) return null

  const isInsideArchive = item.location.chain.length > 0
  const internalPath = item.location.chain.map((c) => c.entryPath).join(' / ')

  async function copyPath(): Promise<void> {
    await navigator.clipboard.writeText(item!.location.diskPath)
    showToast('Caminho copiado')
  }

  async function copyFullPath(): Promise<void> {
    const text = isInsideArchive ? `${item!.location.diskPath}\n→ ${internalPath}` : item!.location.diskPath
    await navigator.clipboard.writeText(text)
    showToast('Caminho completo copiado')
  }

  async function openFolder(): Promise<void> {
    await window.api.openContainingFolder(item!.location.diskPath)
  }

  async function extract(): Promise<void> {
    const dest = await window.api.selectDestinationFolder()
    if (!dest) return
    const savedPath = await window.api.extractSingle({
      location: item!.location,
      fileName: item!.fileName,
      destinationFolder: dest
    })
    showToast(`XML extraído para ${savedPath}`)
  }

  return (
    <div className="overlay" onClick={() => setSelectedItem(null)}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <strong>Detalhes do XML</strong>
          <button className="close-btn" onClick={() => setSelectedItem(null)}>
            <X className="icon" />
          </button>
        </div>

        <div className="detail-group">
          <div className="detail-label">Nome do arquivo</div>
          <div className="detail-value mono">{item.fileName}</div>
        </div>

        <div className="detail-group">
          <div className="detail-label">Chave</div>
          <div className="detail-value mono">{item.chave ?? '—'}</div>
        </div>

        <div className="detail-group">
          <div className="detail-label">Tipo de documento</div>
          <div className="detail-value">{item.docType}</div>
        </div>

        {(item.numero || item.serie) && (
          <div className="detail-group">
            <div className="detail-label">Número / Série</div>
            <div className="detail-value mono">
              {item.numero ?? '—'} / {item.serie ?? '—'}
            </div>
          </div>
        )}

        {item.emitCnpj && (
          <div className="detail-group">
            <div className="detail-label">CNPJ do emitente</div>
            <div className="detail-value mono">{item.emitCnpj}</div>
          </div>
        )}

        {item.dataEmissao && (
          <div className="detail-group">
            <div className="detail-label">Data de emissão</div>
            <div className="detail-value">{item.dataEmissao}</div>
          </div>
        )}

        <div className="detail-group">
          <div className="detail-label">Localização</div>
          <div className="detail-value mono">{item.location.diskPath}</div>
        </div>

        {isInsideArchive && (
          <div className="detail-group">
            <div className="detail-label">Caminho interno</div>
            <div className="detail-value mono">{internalPath}</div>
          </div>
        )}

        <div className="detail-group">
          <div className="detail-label">Tipo de armazenamento</div>
          <div className="detail-value">
            {item.storageType}
            {isInsideArchive ? ` (arquivo: ${basename(item.location.diskPath)})` : ''}
          </div>
        </div>

        <div className="detail-group">
          <div className="detail-label">Tamanho</div>
          <div className="detail-value">{fmtSize(item.sizeBytes)}</div>
        </div>

        <div className="detail-group">
          <div className="detail-label">Localizado por</div>
          <div className="detail-value">
            {item.matchMethod === 'nome'
              ? 'Nome do arquivo'
              : item.matchMethod === 'indice'
                ? 'Índice (pesquisa anterior nesta pasta)'
                : 'Conteúdo do XML'}
          </div>
        </div>

        <div className="detail-actions">
          <button className="btn" onClick={copyPath}>
            <Clipboard className="icon" />
            Copiar caminho
          </button>
          {isInsideArchive && (
            <button className="btn" onClick={copyFullPath}>
              <ClipboardList className="icon" />
              Copiar caminho completo
            </button>
          )}
          <button className="btn" onClick={openFolder}>
            <FolderOpen className="icon" />
            Abrir pasta
          </button>
          <button className="btn" onClick={extract}>
            <Save className="icon" />
            Extrair XML
          </button>
          <button className="btn" onClick={() => setXmlViewerOpen(true)}>
            <Eye className="icon" />
            Visualizar XML
          </button>
        </div>
      </div>

      {xmlViewerOpen && <XmlViewerModal item={item} onClose={() => setXmlViewerOpen(false)} />}
    </div>
  )
}
