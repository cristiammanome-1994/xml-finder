/**
 * Varredura de XML grande em pedaços, sem carregar o arquivo inteiro em memória.
 *
 * Existe porque um XML de lote pode passar de dezenas de MB (exportações mensais com milhares de
 * notas em um único arquivo). Ler tudo em memória para procurar uma chave é caro e arriscado, mas
 * simplesmente desistir depois dos primeiros KB faz a ferramenta reportar "não encontrado" para
 * uma nota que ESTÁ no arquivo — o pior erro possível para quem depende do resultado.
 */

/** Tamanho de cada pedaço lido. Grande o bastante para amortizar o custo por pedaço. */
const CHUNK_BYTES = 1024 * 1024

/**
 * Quantos bytes do fim de um pedaço são repetidos no começo do próximo. Garante que um padrão
 * procurado (chave de 44 dígitos, atributo Id="...", nome colado pelo usuário) não passe
 * despercebido por ter caído exatamente na fronteira entre dois pedaços.
 */
const OVERLAP_BYTES = 1024

export interface StreamScanResult {
  /** true quando a varredura parou antes do fim do arquivo porque onChunk pediu parada. */
  stoppedEarly: boolean
}

/**
 * Lê o stream em pedaços sobrepostos e entrega cada pedaço já decodificado a `onChunk`.
 * `onChunk` retorna true para interromper a leitura (por exemplo, quando tudo o que se procurava
 * já foi encontrado) — o stream é destruído nesse caso, sem ler o resto do arquivo.
 */
export async function scanStreamForXml(
  stream: NodeJS.ReadableStream,
  decode: (buf: Buffer) => string,
  onChunk: (text: string) => boolean
): Promise<StreamScanResult> {
  let carry: Buffer = Buffer.alloc(0)
  let stoppedEarly = false

  try {
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      let pending = carry.length > 0 ? Buffer.concat([carry, buf]) : buf

      while (pending.length >= CHUNK_BYTES) {
        const slice = pending.subarray(0, CHUNK_BYTES)
        if (onChunk(decode(slice))) {
          stoppedEarly = true
          break
        }
        pending = pending.subarray(CHUNK_BYTES - OVERLAP_BYTES)
      }

      if (stoppedEarly) break
      carry = pending
    }

    if (!stoppedEarly && carry.length > 0) {
      onChunk(decode(carry))
    }
  } finally {
    destroyStream(stream)
  }

  return { stoppedEarly }
}

function destroyStream(stream: NodeJS.ReadableStream): void {
  const destroyable = stream as { destroy?: () => void }
  try {
    destroyable.destroy?.()
  } catch {
    // stream já encerrado — nada a fazer
  }
}
