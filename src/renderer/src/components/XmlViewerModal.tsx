import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { FoundItem } from '@shared/types'

function formatXml(xml: string): string {
  const collapsed = xml.replace(/>\s*</g, '><').trim()
  let formatted = ''
  let indent = 0
  const tokens = collapsed.split(/(?=<)/g)
  for (const token of tokens) {
    if (!token) continue
    if (/^<\/.+>/.test(token)) {
      indent = Math.max(0, indent - 1)
      formatted += '  '.repeat(indent) + token + '\n'
    } else if (/^<[^!?].*[^/]>$/.test(token) && !/^<[^>]+\/>$/.test(token)) {
      formatted += '  '.repeat(indent) + token + '\n'
      indent++
    } else {
      formatted += '  '.repeat(indent) + token + '\n'
    }
  }
  return formatted.trim()
}

export function XmlViewerModal({ item, onClose }: { item: FoundItem; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .readXmlContent(item.location)
      .then((raw) => {
        if (!cancelled) setContent(formatXml(raw))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [item])

  return (
    <div className="overlay centered" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <strong className="mono">{item.fileName}</strong>
          <button className="close-btn" onClick={onClose}>
            <X className="icon" />
          </button>
        </div>
        <div className="modal-body">
          {error && (
            <div className="key-hint invalid">
              <AlertTriangle className="icon" style={{ width: 13, height: 13 }} />
              Falha ao carregar XML: {error}
            </div>
          )}
          {!error && !content && <div style={{ color: 'var(--muted-foreground)' }}>Carregando...</div>}
          {!error && content && <pre className="xml-view">{content}</pre>}
        </div>
      </div>
    </div>
  )
}
