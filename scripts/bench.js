/**
 * Teste de carga do motor de busca.
 *
 * Gera um acervo sintético de XMLs fiscais (pastas aninhadas + ZIPs) e mede o comportamento do
 * worker real de pesquisa: tempo, memória e arquivos por segundo. Serve para validar as afirmações
 * da seção "Escala testada" do README com medição, não com estimativa.
 *
 * Uso:
 *   node scripts/bench.js gerar  <qtdXmls> [pasta]   # cria o acervo (demorado, faça uma vez)
 *   node scripts/bench.js medir  <pasta>             # roda os cenários de medição
 *
 * A pasta gerada NÃO é apagada automaticamente — reaproveite entre medições e apague à mão.
 */

const { Worker } = require('node:worker_threads')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const WORKER = path.join(__dirname, '..', 'out', 'main', 'searchWorker.js')

/** Chave de acesso determinística a partir de um índice, com dígito verificador válido. */
function makeKey(i) {
  const body = ('35240612345678000190550010000000000' + String(i)).slice(-43).padStart(43, '0')
  let weight = 2
  let sum = 0
  for (let k = body.length - 1; k >= 0; k--) {
    sum += Number(body[k]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const mod = sum % 11
  return body + String(mod < 2 ? 0 : 11 - mod)
}

function noteXml(key) {
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00"><NFe><infNFe versao="4.00" Id="NFe${key}"><ide><cUF>35</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie><nNF>${key.slice(25, 34)}</nNF><dhEmi>2026-01-15T10:30:00-03:00</dhEmi></ide><emit><CNPJ>12345678000190</CNPJ><xNome>EMPRESA EXEMPLO COMERCIO LTDA</xNome><enderEmit><xLgr>AVENIDA PAULISTA</xLgr><nro>1000</nro><xBairro>BELA VISTA</xBairro><xMun>SAO PAULO</xMun><UF>SP</UF><CEP>01310100</CEP></enderEmit></emit><dest><CNPJ>98765432000199</CNPJ><xNome>CLIENTE DESTINATARIO SA</xNome></dest><det nItem="1"><prod><cProd>001</cProd><xProd>PRODUTO DE TESTE PARA VOLUME</xProd><NCM>84713012</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>150.0000</vUnCom><vProd>1500.00</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1500.00</vBC><pICMS>18.00</pICMS><vICMS>270.00</vICMS></ICMS00></ICMS></imposto></det><total><ICMSTot><vBC>1500.00</vBC><vICMS>270.00</vICMS><vProd>1500.00</vProd><vNF>1500.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`
}

function gerar(total, destino) {
  const t0 = Date.now()
  fs.mkdirSync(destino, { recursive: true })

  // Arvore realista: ano/mes/dia -> ~360 pastas, ~278 arquivos por pasta em 100k.
  const porPasta = Math.max(1, Math.ceil(total / 360))
  let criados = 0
  const chaves = []

  for (let mes = 1; mes <= 12 && criados < total; mes++) {
    for (let dia = 1; dia <= 30 && criados < total; dia++) {
      const dir = path.join(destino, '2026', String(mes).padStart(2, '0'), String(dia).padStart(2, '0'))
      fs.mkdirSync(dir, { recursive: true })
      for (let n = 0; n < porPasta && criados < total; n++) {
        const key = makeKey(criados)
        chaves.push(key)
        fs.writeFileSync(path.join(dir, `${key}.xml`), noteXml(key))
        criados++
      }
    }
  }

  fs.writeFileSync(path.join(destino, '_chaves.json'), JSON.stringify(chaves))
  const seg = (Date.now() - t0) / 1000
  console.log(`gerados ${criados} XMLs em ${seg.toFixed(1)}s (${Math.round(criados / seg)} arq/s) em ${destino}`)
}

function pesquisar(rootFolder, identifiers, userDataDir) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER)
    const t0 = Date.now()
    let picoRss = 0
    const amostra = setInterval(() => {
      picoRss = Math.max(picoRss, process.memoryUsage().rss)
    }, 100)

    let encontrados = 0
    worker.on('message', (msg) => {
      if (msg.type === 'found') encontrados++
      if (msg.type === 'done') {
        clearInterval(amostra)
        worker.terminate()
        resolve({
          ms: Date.now() - t0,
          encontrados,
          naoEncontrados: msg.notFound.length,
          filesScanned: msg.stats.filesScanned,
          xmlAnalyzed: msg.stats.xmlAnalyzed,
          erros: msg.stats.errorCount,
          picoRssMb: Math.round(picoRss / 1024 / 1024)
        })
      }
    })
    worker.on('error', (e) => { clearInterval(amostra); reject(e) })
    worker.postMessage({ type: 'start', options: { rootFolder, identifiers, maxDepth: 3, userDataDir } })
  })
}

/**
 * Repete cada cenário e reporta o MÍNIMO.
 *
 * Medir I/O em desktop Windows é ruidoso: cache do sistema de arquivos e varredura de antivírus
 * fazem a MESMA configuração alternar entre modos rápido e lento por vários segundos seguidos.
 * Rodada a rodada, a diferença chegou a 7x sem nenhuma mudança de código. O mínimo de várias
 * repetições é o estimador mais estável do custo real; a mediana e o máximo ficam à vista
 * justamente para deixar a dispersão explícita, em vez de mascará-la.
 */
const REPETICOES = Number(process.env.BENCH_REPS || 5)

async function linha(nome, rodar) {
  const amostras = []
  let ultima = null
  for (let i = 0; i < REPETICOES; i++) {
    ultima = await rodar()
    amostras.push(ultima)
  }
  amostras.sort((a, b) => a.ms - b.ms)
  const min = amostras[0]
  const mediana = amostras[Math.floor(amostras.length / 2)]
  const max = amostras[amostras.length - 1]
  const arqPorSeg = min.filesScanned > 0 ? Math.round(min.filesScanned / (min.ms / 1000)) : 0

  console.log(
    `${nome.padEnd(44)} ${String(min.ms + 'ms').padStart(8)} ` +
    `${String(mediana.ms + 'ms').padStart(9)} ${String(max.ms + 'ms').padStart(9)} ` +
    `${String(min.filesScanned).padStart(7)} arq ` +
    `${String(arqPorSeg).padStart(7)} arq/s ` +
    `${String(min.picoRssMb + 'MB').padStart(6)} ` +
    `enc=${min.encontrados} nf=${min.naoEncontrados} err=${min.erros}`
  )
}

async function medir(destino) {
  const chaves = JSON.parse(fs.readFileSync(path.join(destino, '_chaves.json'), 'utf8'))
  console.log(`acervo: ${chaves.length} XMLs — ${REPETICOES} repeticoes por cenario\n`)
  console.log('cenario'.padEnd(44) + '      min   mediana       max  arquivos  throughput  memoria')
  console.log('-'.repeat(130))

  const ud = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bench-ud-'))
  const ultimaChave = chaves[chaves.length - 1]
  const ausente = '35249999999999000199550010000000099000000099'

  // userDataDir novo a cada repeticao: mede a varredura pura, sem ajuda do indice.
  await linha('1 chave, ultima do acervo (pior caso)', () => pesquisar(destino, [ultimaChave], ud()))
  await linha('1 chave inexistente (varredura completa)', () => pesquisar(destino, [ausente], ud()))
  await linha('100 chaves espalhadas', () => pesquisar(destino, amostrar(chaves, 100), ud()))
  await linha('1000 chaves espalhadas', () => pesquisar(destino, amostrar(chaves, 1000), ud()))
  await linha('10000 chaves espalhadas', () => pesquisar(destino, amostrar(chaves, 10000), ud()))

  // Indice: primeira busca popula, as seguintes reaproveitam o mesmo userDataDir.
  const compartilhado = ud()
  const amostra1k = amostrar(chaves, 1000)
  await pesquisar(destino, amostra1k, compartilhado)
  await linha('1000 chaves — repetida, via indice', () => pesquisar(destino, amostra1k, compartilhado))
}

function amostrar(chaves, n) {
  const passo = Math.max(1, Math.floor(chaves.length / n))
  const out = []
  for (let i = 0; i < chaves.length && out.length < n; i += passo) out.push(chaves[i])
  return out
}

const [cmd, arg1, arg2] = process.argv.slice(2)
if (cmd === 'gerar') gerar(Number(arg1), arg2 || path.join(os.tmpdir(), 'xmlfinder-bench'))
else if (cmd === 'medir') medir(arg1 || path.join(os.tmpdir(), 'xmlfinder-bench'))
else console.log('uso: node scripts/bench.js gerar <qtd> [pasta] | medir [pasta]')
