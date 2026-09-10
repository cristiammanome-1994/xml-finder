import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { readLocationContent, extractSingleFile } from './extractor.ts'

function u16(n: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n)
  return b
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0)
  return b
}

/**
 * Monta um ZIP mínimo de uma entrada só. `declaredUncompressedSize` permite forjar o tamanho
 * descomprimido no cabeçalho, independente do conteúdo real comprimido — exatamente como um zip
 * bomb declara um tamanho enorme a partir de poucos bytes comprimidos.
 */
function buildZip(entryName: string, content: Buffer, declaredUncompressedSize?: number): Buffer {
  const raw = zlib.deflateRawSync(content)
  const name = Buffer.from(entryName)
  const uncompSize = declaredUncompressedSize ?? content.length
  const crc = 0 // não validado por yauzl na leitura simples usada aqui
  const lfh = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc), u32(raw.length), u32(uncompSize), u16(name.length), u16(0), name
  ])
  const cd = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc), u32(raw.length), u32(uncompSize), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name
  ])
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(cd.length), u32(lfh.length + raw.length), u16(0)])
  return Buffer.concat([lfh, raw, cd, eocd])
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xmlfinder-extractor-test-'))
}

test('lê normalmente o conteúdo de um arquivo solto (sem chain)', async () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, 'nota.xml'), '<a>ok</a>')
  const content = await readLocationContent({ diskPath: path.join(dir, 'nota.xml'), chain: [] })
  assert.equal(content.toString('utf8'), '<a>ok</a>')
})

test('lê normalmente uma entrada de tamanho legítimo dentro de um ZIP', async () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, 'legit.zip'), buildZip('legit.xml', Buffer.from('<a>ok</a>')))
  const content = await readLocationContent({
    diskPath: path.join(dir, 'legit.zip'),
    chain: [{ containerType: 'zip', entryPath: 'legit.xml' }]
  })
  assert.equal(content.toString('utf8'), '<a>ok</a>')
})

test('recusa entrada de ZIP com tamanho descomprimido declarado acima do teto (zip bomb)', async () => {
  const dir = tmpDir()
  // Declara 500MB de tamanho descomprimido a partir de pouquíssimos bytes reais comprimidos.
  const bomba = buildZip('bomba.xml', Buffer.from('x'.repeat(1000)), 500 * 1024 * 1024)
  fs.writeFileSync(path.join(dir, 'bomba.zip'), bomba)

  await assert.rejects(
    readLocationContent({ diskPath: path.join(dir, 'bomba.zip'), chain: [{ containerType: 'zip', entryPath: 'bomba.xml' }] }),
    /limite/i
  )
})

test('recusa entrada aninhada com tamanho acima do teto mesmo quando não é o passo final da chain', async () => {
  const dir = tmpDir()
  const innerZip = buildZip('bomba.xml', Buffer.from('x'.repeat(1000)), 500 * 1024 * 1024)
  const outerZip = buildZip('meio.zip', innerZip)
  fs.writeFileSync(path.join(dir, 'externo.zip'), outerZip)

  await assert.rejects(
    readLocationContent({
      diskPath: path.join(dir, 'externo.zip'),
      chain: [
        { containerType: 'zip', entryPath: 'meio.zip' },
        { containerType: 'zip', entryPath: 'bomba.xml' }
      ]
    }),
    /limite/i
  )
})

test('entrada inexistente no ZIP lança erro claro, não zip bomb', async () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, 'pacote.zip'), buildZip('a.xml', Buffer.from('x')))
  await assert.rejects(
    readLocationContent({ diskPath: path.join(dir, 'pacote.zip'), chain: [{ containerType: 'zip', entryPath: 'nao-existe.xml' }] }),
    /não encontrada/i
  )
})

test('extractSingleFile grava o arquivo com o nome dado, dentro da pasta de destino', async () => {
  const dir = tmpDir()
  const dest = tmpDir()
  fs.writeFileSync(path.join(dir, 'nota.xml'), '<a>conteudo</a>')

  const savedPath = await extractSingleFile({ diskPath: path.join(dir, 'nota.xml'), chain: [] }, 'nota.xml', dest)
  assert.equal(savedPath, path.join(dest, 'nota.xml'))
  assert.equal(fs.readFileSync(savedPath, 'utf8'), '<a>conteudo</a>')
})

test('extractSingleFile evita sobrescrever: adiciona sufixo numérico se o nome já existe no destino', async () => {
  const dir = tmpDir()
  const dest = tmpDir()
  fs.writeFileSync(path.join(dir, 'nota.xml'), '<a>versao-nova</a>')
  fs.writeFileSync(path.join(dest, 'nota.xml'), '<a>ja-existia</a>')

  const savedPath = await extractSingleFile({ diskPath: path.join(dir, 'nota.xml'), chain: [] }, 'nota.xml', dest)
  assert.notEqual(savedPath, path.join(dest, 'nota.xml'))
  assert.equal(fs.readFileSync(path.join(dest, 'nota.xml'), 'utf8'), '<a>ja-existia</a>', 'arquivo original não foi sobrescrito')
  assert.equal(fs.readFileSync(savedPath, 'utf8'), '<a>versao-nova</a>')
})

test('extractSingleFile rejeita nome de arquivo vazio ou "." / ".." (barreira contra zip-slip)', async () => {
  const dir = tmpDir()
  const dest = tmpDir()
  fs.writeFileSync(path.join(dir, 'nota.xml'), '<a/>')

  await assert.rejects(extractSingleFile({ diskPath: path.join(dir, 'nota.xml'), chain: [] }, '..', dest))
  await assert.rejects(extractSingleFile({ diskPath: path.join(dir, 'nota.xml'), chain: [] }, '.', dest))
})

test('extractSingleFile reduz um nome com componente de caminho a apenas o nome do arquivo', async () => {
  const dir = tmpDir()
  const dest = tmpDir()
  fs.writeFileSync(path.join(dir, 'nota.xml'), '<a/>')

  const savedPath = await extractSingleFile({ diskPath: path.join(dir, 'nota.xml'), chain: [] }, '../../evil.xml', dest)
  assert.equal(savedPath, path.join(dest, 'evil.xml'), 'componentes de diretório no nome são descartados, fica só o basename')
})
