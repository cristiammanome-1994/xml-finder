import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { is } from './env'
import type {
  SearchOptions,
  SearchWorkerMessage,
  ExtractRequest,
  FileLocation,
  HistoryEntry,
  ResultItem
} from '@shared/types'
import { validateAccessKey } from '@shared/keyUtils'
import { extractSingleFile, readLocationContent } from './engine/extractor'
import { appendHistoryEntry, clearHistory, loadHistory } from './engine/history'

let mainWindow: BrowserWindow | null = null
let activeWorker: Worker | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpcHandlers(): void {
  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectDestinationFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('key:validate', (_e, identifier: string) => validateAccessKey(identifier))

  ipcMain.handle('search:start', (_e, options: SearchOptions) => {
    startSearch(options)
  })

  ipcMain.handle('search:cancel', () => {
    activeWorker?.postMessage({ type: 'cancel' })
  })

  ipcMain.handle('shell:openContainingFolder', (_e, targetPath: string) => {
    shell.showItemInFolder(targetPath)
  })

  ipcMain.handle('file:readXmlContent', async (_e, location: FileLocation) => {
    const buf = await readLocationContent(location)
    return buf.toString('utf8')
  })

  ipcMain.handle('file:extractSingle', async (_e, req: ExtractRequest) => {
    return extractSingleFile(req.location, req.fileName, req.destinationFolder)
  })

  ipcMain.handle('export:results', async (_e, items: ResultItem[], format: 'xlsx' | 'csv') => {
    const defaultName = format === 'xlsx' ? 'resultados-xml-finder.xlsx' : 'resultados-xml-finder.csv'
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: format === 'xlsx' ? [{ name: 'Excel', extensions: ['xlsx'] }] : [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return null
    const { exportToCsv, exportToExcel } = await import('./engine/exporter')
    if (format === 'xlsx') await exportToExcel(items, result.filePath)
    else await exportToCsv(items, result.filePath)
    return result.filePath
  })

  ipcMain.handle('history:list', () => loadHistory(app.getPath('userData')))

  ipcMain.handle('history:append', async (_e, entry: Omit<HistoryEntry, 'id' | 'date'>) => {
    const full: HistoryEntry = { ...entry, id: randomUUID(), date: Date.now() }
    return appendHistoryEntry(app.getPath('userData'), full)
  })

  ipcMain.handle('history:clear', () => clearHistory(app.getPath('userData')))
}

/** Emite um 'done' sintético para a renderer sempre que a pesquisa não pôde nem começar de verdade. */
function emitFatalSearchError(message: string): void {
  mainWindow?.webContents.send('search:message', {
    type: 'done',
    stats: {
      filesScanned: 0,
      xmlAnalyzed: 0,
      zipCount: 0,
      rarCount: 0,
      foundCount: 0,
      notFoundCount: 0,
      errorCount: 1,
      elapsedMs: 0,
      estimatedTotal: 0,
      phase: 'erro'
    },
    notFound: [],
    limitationNotes: [message]
  } satisfies SearchWorkerMessage)
}

function startSearch(options: SearchOptions): void {
  if (activeWorker) {
    // Remove os listeners ANTES de terminar: terminate() para o worker "assim que possível",
    // não instantaneamente, e sem isso uma mensagem que ele já estava enviando poderia chegar
    // à renderer misturada com as da nova pesquisa (mesmo canal IPC, sem id de pesquisa).
    activeWorker.removeAllListeners()
    activeWorker.postMessage({ type: 'cancel' })
    activeWorker.terminate()
    activeWorker = null
  }

  const workerPath = path.join(__dirname, 'searchWorker.js')
  if (!fs.existsSync(workerPath)) {
    emitFatalSearchError(`Worker de pesquisa não encontrado em ${workerPath}`)
    return
  }

  let worker: Worker
  try {
    worker = new Worker(workerPath)
  } catch (err) {
    emitFatalSearchError(`Falha ao iniciar o worker de pesquisa: ${(err as Error).message}`)
    return
  }
  activeWorker = worker

  worker.on('message', (msg: SearchWorkerMessage) => {
    mainWindow?.webContents.send('search:message', msg)
    if (msg.type === 'done') {
      worker.terminate()
      if (activeWorker === worker) activeWorker = null
    }
  })

  worker.on('error', (err: Error) => {
    emitFatalSearchError(`Erro no worker de pesquisa: ${err.message}`)
    worker.terminate()
    if (activeWorker === worker) activeWorker = null
  })

  worker.postMessage({ type: 'start', options })
}
