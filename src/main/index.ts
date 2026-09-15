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
import { extractSingleFile, readLocationContent } from './engine/extractor'
import { decodeXmlBuffer } from './engine/xmlEncoding'
import { appendHistoryEntry, clearHistory, loadHistory } from './engine/history'
import { PathScope } from './pathScope'

let mainWindow: BrowserWindow | null = null
let activeWorker: Worker | null = null

/** Ver PathScope: valida que caminhos vindos do renderer via IPC pertencem a uma pasta já
 * legitimamente associada a uma busca (real ou reaberta do histórico) nesta sessão. */
const pathScope = new PathScope()

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

async function handleSelectFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

async function handleSelectDestinationFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

async function handleStartSearchIpc(_e: unknown, options: SearchOptions): Promise<void> {
  await startSearch(options)
}

function handleCancelSearch(): void {
  activeWorker?.postMessage({ type: 'cancel' })
}

function handleOpenContainingFolder(_e: unknown, targetPath: string): void {
  pathScope.assertKnown(targetPath)
  shell.showItemInFolder(targetPath)
}

async function handleReadXmlContent(_e: unknown, location: FileLocation): Promise<string> {
  pathScope.assertKnown(location.diskPath)
  const buf = await readLocationContent(location)
  // Respeita o encoding declarado no XML: muitos emissores ainda geram ISO-8859-1, e decodificar
  // como UTF-8 corromperia todo texto acentuado (razão social, endereço) na visualização.
  return decodeXmlBuffer(buf)
}

async function handleExtractSingle(_e: unknown, req: ExtractRequest): Promise<string> {
  pathScope.assertKnown(req.location.diskPath)
  return extractSingleFile(req.location, req.fileName, req.destinationFolder)
}

async function handleExportResults(_e: unknown, items: ResultItem[], format: 'xlsx' | 'csv'): Promise<string | null> {
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
}

async function handleHistoryList(): Promise<HistoryEntry[]> {
  const entries = await loadHistory(app.getPath('userData'))
  // Reabrir uma pesquisa do histórico deve continuar funcionando mesmo que a pasta pesquisada
  // seja diferente da última busca ao vivo desta sessão — por isso toda pasta do histórico
  // também entra no conjunto de pastas conhecidas, assim que listada.
  for (const entry of entries) pathScope.remember(entry.rootFolder)
  return entries
}

async function handleHistoryAppend(_e: unknown, entry: Omit<HistoryEntry, 'id' | 'date'>): Promise<HistoryEntry[]> {
  const full: HistoryEntry = { ...entry, id: randomUUID(), date: Date.now() }
  return appendHistoryEntry(app.getPath('userData'), full)
}

function handleHistoryClear(): Promise<void> {
  return clearHistory(app.getPath('userData'))
}

async function handleIndexClear(): Promise<void> {
  const { clearSearchIndex } = await import('./engine/searchIndex')
  await clearSearchIndex(app.getPath('userData'))
}

function registerIpcHandlers(): void {
  ipcMain.handle('dialog:selectFolder', handleSelectFolder)
  ipcMain.handle('dialog:selectDestinationFolder', handleSelectDestinationFolder)
  ipcMain.handle('search:start', handleStartSearchIpc)
  ipcMain.handle('search:cancel', handleCancelSearch)
  ipcMain.handle('shell:openContainingFolder', handleOpenContainingFolder)
  ipcMain.handle('file:readXmlContent', handleReadXmlContent)
  ipcMain.handle('file:extractSingle', handleExtractSingle)
  ipcMain.handle('export:results', handleExportResults)
  ipcMain.handle('history:list', handleHistoryList)
  ipcMain.handle('history:append', handleHistoryAppend)
  ipcMain.handle('history:clear', handleHistoryClear)
  ipcMain.handle('index:clear', handleIndexClear)
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

/** Encerra a busca anterior em andamento, se houver, antes de iniciar uma nova. */
function terminatePreviousWorker(): void {
  if (!activeWorker) return
  // Remove os listeners ANTES de terminar: terminate() para o worker "assim que possível",
  // não instantaneamente, e sem isso uma mensagem que ele já estava enviando poderia chegar
  // à renderer misturada com as da nova pesquisa (mesmo canal IPC, sem id de pesquisa).
  activeWorker.removeAllListeners()
  activeWorker.postMessage({ type: 'cancel' })
  activeWorker.terminate()
  activeWorker = null
}

/** Confirma que a pasta raiz existe e é um diretório. Emite o erro fatal e retorna false se não. */
async function validateRootFolder(rootFolder: string): Promise<boolean> {
  try {
    const st = await fs.promises.stat(rootFolder)
    if (!st.isDirectory()) {
      emitFatalSearchError(`O caminho selecionado não é uma pasta: ${rootFolder}`)
      return false
    }
    return true
  } catch {
    emitFatalSearchError(`Pasta não encontrada: ${rootFolder}`)
    return false
  }
}

async function startSearch(options: SearchOptions): Promise<void> {
  terminatePreviousWorker()

  if (!(await validateRootFolder(options.rootFolder))) return
  pathScope.remember(options.rootFolder)

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

  worker.postMessage({ type: 'start', options: { ...options, userDataDir: app.getPath('userData') } })
}
