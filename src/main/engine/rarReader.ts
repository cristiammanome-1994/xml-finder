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

/**
 * Extrai o `ArrayBuffer` exato correspondente ao `Buffer`, copiando só quando ele é uma view
 * parcial de um `ArrayBuffer` maior (pool interno do Node, usado para buffers pequenos — acima de
 * ~8KB o Node já aloca um `ArrayBuffer` dedicado, que é o caso comum de RAR em disco e de entradas
 * aninhadas extraídas). Nesse caso comum, evita duplicar em memória o arquivo RAR inteiro só para
 * obter um `ArrayBuffer` que já era exatamente esse.
 */
function toExactArrayBuffer(buffer: Buffer): ArrayBuffer {
  if (buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength) {
    return buffer.buffer as ArrayBuffer
  }
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

function getWasmBinary(): ArrayBuffer {
  if (!wasmBinaryCache) {
    const wasmPath = require.resolve('node-unrar-js/dist/js/unrar.wasm')
    wasmBinaryCache = toExactArrayBuffer(fs.readFileSync(wasmPath))
  }
  return wasmBinaryCache
}

/** Abre um RAR a partir de um buffer em memória (funciona tanto para RAR em disco quanto aninhado). */
export async function openRarFromBuffer(buffer: Buffer): Promise<OpenRarFile> {
  const unrar = loadUnrarModule()
  const data = toExactArrayBuffer(buffer)

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
