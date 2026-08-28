import fs from 'node:fs'
import { createRequire } from 'node:module'

// node-unrar-js expõe um binário wasm que precisa ser localizado manualmente quando
// o bundler (Vite/Rollup) empacota o código — carregamos explicitamente para evitar
// depender de resolução automática do pacote em tempo de execução.
const require = createRequire(import.meta.url)

export interface RarEntryInfo {
  fileName: string
  size: number
  isDirectory: boolean
  isEncrypted: boolean
}

export interface OpenRarFile {
  entries: RarEntryInfo[]
  readEntries: (fileNames: string[]) => Promise<Map<string, Buffer>>
}

let wasmBinaryCache: ArrayBuffer | null = null
let unrarModuleCache: typeof import('node-unrar-js') | null = null

function loadUnrarModule(): typeof import('node-unrar-js') {
  if (!unrarModuleCache) {
    unrarModuleCache = require('node-unrar-js')
  }
  return unrarModuleCache!
}

function getWasmBinary(): ArrayBuffer {
  if (!wasmBinaryCache) {
    const wasmPath = require.resolve('node-unrar-js/dist/js/unrar.wasm')
    const buf = fs.readFileSync(wasmPath)
    wasmBinaryCache = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }
  return wasmBinaryCache
}

/** Abre um RAR a partir de um buffer em memória (funciona tanto para RAR em disco quanto aninhado). */
export async function openRarFromBuffer(buffer: Buffer): Promise<OpenRarFile> {
  const unrar = loadUnrarModule()
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

  const extractor = await unrar.createExtractorFromData({
    data,
    wasmBinary: getWasmBinary()
  })

  const list = extractor.getFileList()
  const entries: RarEntryInfo[] = []
  for (const fh of list.fileHeaders) {
    entries.push({
      fileName: fh.name,
      size: fh.unpSize,
      isDirectory: fh.flags.directory,
      isEncrypted: fh.flags.encrypted
    })
  }

  return {
    entries,
    readEntries: async (fileNames: string[]) => {
      const result = new Map<string, Buffer>()
      if (fileNames.length === 0) return result
      const extracted = extractor.extract({ files: fileNames })
      for (const file of extracted.files) {
        if (file.extraction) {
          result.set(file.fileHeader.name, Buffer.from(file.extraction))
        }
      }
      return result
    }
  }
}

export async function openRarFromFile(filePath: string): Promise<OpenRarFile> {
  const buffer = await fs.promises.readFile(filePath)
  return openRarFromBuffer(buffer)
}
