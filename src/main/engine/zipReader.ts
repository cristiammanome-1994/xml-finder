import yauzl from 'yauzl'

export interface ZipEntryInfo {
  fileName: string
  size: number
  compressedSize: number
  isDirectory: boolean
  isEncrypted: boolean
  lastModified: number | null
  raw: yauzl.Entry
}

export interface OpenZip {
  entries: ZipEntryInfo[]
  readEntry: (entry: ZipEntryInfo, maxBytes?: number) => Promise<Buffer>
  readEntryFull: (entry: ZipEntryInfo) => Promise<Buffer>
  close: () => void
}

/** Abre um ZIP a partir de um caminho em disco (streaming, sem extrair tudo). */
export function openZipFromFile(filePath: string): Promise<OpenZip> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: false, autoClose: false }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('Falha ao abrir ZIP'))
      finishOpen(zipfile, resolve, reject)
    })
  })
}

/** Abre um ZIP a partir de um buffer em memória (usado para ZIPs aninhados dentro de outros arquivos). */
export function openZipFromBuffer(buffer: Buffer): Promise<OpenZip> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: false, autoClose: false }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('Falha ao abrir ZIP aninhado'))
      finishOpen(zipfile, resolve, reject)
    })
  })
}

function finishOpen(
  zipfile: yauzl.ZipFile,
  resolve: (v: OpenZip) => void,
  reject: (e: Error) => void
): void {
  const entries: ZipEntryInfo[] = []
  let settled = false

  zipfile.on('entry', (entry: yauzl.Entry) => {
    const isDirectory = /\/$/.test(entry.fileName)
    const isEncrypted = (entry.generalPurposeBitFlag & 0x1) !== 0
    entries.push({
      fileName: entry.fileName,
      size: entry.uncompressedSize,
      compressedSize: entry.compressedSize,
      isDirectory,
      isEncrypted,
      lastModified: entry.getLastModDate ? entry.getLastModDate().getTime() : null,
      raw: entry
    })
  })

  zipfile.on('end', () => {
    if (settled) return
    settled = true
    resolve({
      entries,
      readEntry: (entry, maxBytes) => readZipEntry(zipfile, entry.raw, maxBytes),
      readEntryFull: (entry) => readZipEntry(zipfile, entry.raw),
      close: () => zipfile.close()
    })
  })

  zipfile.on('error', (err) => {
    if (settled) return
    settled = true
    reject(err)
  })
}

function readZipEntry(zipfile: yauzl.ZipFile, entry: yauzl.Entry, maxBytes?: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error('Falha ao ler entrada do ZIP'))
      const chunks: Buffer[] = []
      let total = 0
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve(Buffer.concat(chunks))
      }
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        total += chunk.length
        if (maxBytes && total >= maxBytes) {
          stream.destroy()
          finish()
        }
      })
      stream.on('close', finish)
      stream.on('end', finish)
      stream.on('error', (e) => {
        if (settled) return
        settled = true
        reject(e)
      })
    })
  })
}
