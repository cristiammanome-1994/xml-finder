import fs from 'node:fs'
import path from 'node:path'

export type FileKind = 'xml' | 'zip' | 'rar' | 'other'

const SNIFF_SIZE_CAP = 25 * 1024 * 1024 // não faz sniff de conteúdo em arquivos maiores que isso sem extensão reconhecida

const ZIP_MAGIC = [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0x50, 0x4b, 0x05, 0x06])]
const RAR_MAGIC = Buffer.from('Rar!\x1a\x07', 'binary')

/** Classifica um arquivo em disco por extensão (caminho rápido) e, se necessário, por assinatura de conteúdo. */
export function classifyByExtension(filePath: string): FileKind | null {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.xml') return 'xml'
  if (ext === '.zip') return 'zip'
  if (ext === '.rar') return 'rar'
  return null
}

/** Faz sniff dos primeiros bytes do arquivo para identificar tipo real quando a extensão não ajuda. */
export async function sniffFileKind(filePath: string, size: number): Promise<FileKind> {
  if (size === 0 || size > SNIFF_SIZE_CAP) return 'other'
  let fd: fs.promises.FileHandle | null = null
  try {
    fd = await fs.promises.open(filePath, 'r')
    const buf = Buffer.alloc(Math.min(512, size))
    await fd.read(buf, 0, buf.length, 0)
    return classifyBuffer(buf)
  } catch {
    return 'other'
  } finally {
    await fd?.close()
  }
}

export function classifyBuffer(buf: Buffer): FileKind {
  for (const magic of ZIP_MAGIC) {
    if (buf.length >= magic.length && buf.subarray(0, magic.length).equals(magic)) return 'zip'
  }
  if (buf.length >= RAR_MAGIC.length && buf.subarray(0, RAR_MAGIC.length).equals(RAR_MAGIC)) return 'rar'

  let text = buf.toString('utf8', 0, Math.min(buf.length, 256))
  text = text.replace(/^﻿/, '').trimStart()
  if (text.startsWith('<?xml') || (text.startsWith('<') && text.includes('>'))) return 'xml'

  return 'other'
}
