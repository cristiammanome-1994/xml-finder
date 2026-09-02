import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { scanStreamForXml } from './streamScanner.ts'

const decodeUtf8 = (buf: Buffer): string => buf.toString('utf8')

function streamOf(text: string, chunkSize = 64 * 1024): Readable {
  const buf = Buffer.from(text, 'utf8')
  const chunks: Buffer[] = []
  for (let i = 0; i < buf.length; i += chunkSize) chunks.push(buf.subarray(i, i + chunkSize))
  return Readable.from(chunks)
}

test('entrega todo o conteúdo de um arquivo pequeno em um único pedaço', async () => {
  const seen: string[] = []
  await scanStreamForXml(streamOf('<a>conteudo curto</a>'), decodeUtf8, (text) => {
    seen.push(text)
    return false
  })
  assert.equal(seen.join(''), '<a>conteudo curto</a>')
})

test('encontra uma chave posicionada muito além do primeiro pedaço', async () => {
  // Este é o cenário que antes produzia um falso "não encontrado": a chave está
  // depois de vários MB de conteúdo, longe do início do arquivo.
  const key = '35240612345678000190550010000012341123456789'
  const filler = 'x'.repeat(5 * 1024 * 1024)
  const xml = `<enviNFe>${filler}<infNFe Id="NFe${key}"/></enviNFe>`

  let encontrada = false
  await scanStreamForXml(streamOf(xml), decodeUtf8, (text) => {
    if (text.includes(key)) encontrada = true
    return false
  })

  assert.ok(encontrada, 'a chave precisa ser encontrada mesmo estando a megabytes do início')
})

test('a sobreposição entre pedaços impede perder um padrão na fronteira', async () => {
  const key = '35240612345678000190550010000012341123456789'
  // Posiciona a chave exatamente em volta do limite de 1MB entre pedaços.
  const prefix = 'y'.repeat(1024 * 1024 - Math.floor(key.length / 2))
  const xml = prefix + key + 'resto'

  let encontrada = false
  await scanStreamForXml(streamOf(xml), decodeUtf8, (text) => {
    if (text.includes(key)) encontrada = true
    return false
  })

  assert.ok(encontrada, 'a chave está partida ao meio entre dois pedaços e ainda assim deve ser vista')
})

test('para de ler assim que onChunk pede parada', async () => {
  const xml = 'z'.repeat(10 * 1024 * 1024)
  let chunks = 0
  const result = await scanStreamForXml(streamOf(xml), decodeUtf8, () => {
    chunks++
    return true
  })

  assert.equal(chunks, 1, 'não deve continuar lendo o resto do arquivo')
  assert.equal(result.stoppedEarly, true)
})

test('stream vazio não quebra e não chama onChunk', async () => {
  let chamou = false
  const result = await scanStreamForXml(streamOf(''), decodeUtf8, () => {
    chamou = true
    return false
  })
  assert.equal(chamou, false)
  assert.equal(result.stoppedEarly, false)
})
