import { contextBridge, ipcRenderer } from 'electron'
import type {
  SearchOptions,
  SearchWorkerMessage,
  ExtractRequest,
  FileLocation,
  HistoryEntry,
  KeyValidation,
  ResultItem
} from '@shared/types'

const api = {
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFolder'),
  selectDestinationFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDestinationFolder'),

  validateKey: (identifier: string): Promise<KeyValidation> => ipcRenderer.invoke('key:validate', identifier),

  startSearch: (options: SearchOptions): Promise<void> => ipcRenderer.invoke('search:start', options),
  cancelSearch: (): Promise<void> => ipcRenderer.invoke('search:cancel'),
  onSearchMessage: (cb: (msg: SearchWorkerMessage) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: SearchWorkerMessage): void => cb(msg)
    ipcRenderer.on('search:message', listener)
    return () => ipcRenderer.removeListener('search:message', listener)
  },

  openContainingFolder: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke('shell:openContainingFolder', targetPath),

  readXmlContent: (location: FileLocation): Promise<string> => ipcRenderer.invoke('file:readXmlContent', location),

  extractSingle: (req: ExtractRequest): Promise<string> => ipcRenderer.invoke('file:extractSingle', req),

  exportResults: (items: ResultItem[], format: 'xlsx' | 'csv'): Promise<string | null> =>
    ipcRenderer.invoke('export:results', items, format),

  listHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:list'),
  appendHistory: (entry: Omit<HistoryEntry, 'id' | 'date'>): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke('history:append', entry),
  clearHistory: (): Promise<void> => ipcRenderer.invoke('history:clear')
}

contextBridge.exposeInMainWorld('api', api)

export type XmlFinderApi = typeof api
