/**
 * Mede o motor de busca contra uma pasta REAL (rede/produção), em vez do acervo sintético.
 *
 * Só LÊ. Nunca escreve na pasta alvo — as chaves de amostra vêm dos NOMES dos arquivos (que já
 * costumam carregar a chave de acesso de 44 dígitos), sem abrir/ler o conteúdo de nenhum XML real.
 * O userDataDir (onde o índice de pesquisa seria gravado) é sempre um diretório temporário próprio,
 * nunca a pasta de dados de usuário real do app.
 *
 * Uso: node scripts/bench-real-folder.js "<caminho da pasta>" [maxAmostras]
 */
const { Worker } = require('node:worker_threads')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const WORKER = path.join(__dirname, '..', 'out', 'main', 'searchWorker.js')
const KEY_RE = /\d{44}/

const CAP_CHAVES_COLETADAS = 50000

/**
 * Percorre a árvore inteira coletando TODAS as chaves encontradas nos nomes (até o teto), em vez
 * de parar nas primeiras — assim a amostra usada depois pode ser espalhada pela árvore inteira, não
 * só pelos primeiros arquivos que o SO lista (que tendem a estar todos na mesma subpasta).
 */
function coletarTodasAsChaves(root) {
  const chaves = []
  let arquivos = 0
  let pastas = 0

  function walk(dir) {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        pastas++
        walk(path.join(dir, e.name))
        continue
      }
      if (!e.isFile()) continue
      arquivos++
      if (chaves.length < CAP_CHAVES_COLETADAS) {
        const m = KEY_RE.exec(e.name)
        if (m) chaves.push(m[0])
      }
    }
  }

  walk(root)
  return { chaves: [...new Set(chaves)], arquivos, pastas }
}

/** Amostra espalhada uniformemente pela lista (não só os N primeiros) — útil para simular o pior
 * caso (chaves em pontas opostas da árvore), mas em pastas muito grandes isso empurra o fim da
 * busca para perto do fim da varredura inteira, o que NÃO é o uso típico do dia a dia. */
function amostrarEspalhado(chaves, n) {
  if (chaves.length <= n) return chaves
  const passo = chaves.length / n
  const out = []
  for (let i = 0; i < n; i++) out.push(chaves[Math.floor(i * passo)])
  return out
}

/**
 * Amostra concentrada num único trecho da árvore, a `fracaoInicio` do caminho — representa o uso
 * típico: um contador buscando um lote de notas de um mesmo período/cliente, que tende a estar
 * fisicamente perto na estrutura de pastas, não espalhado de propósito pela base inteira.
 */
function amostrarConcentrado(chaves, n, fracaoInicio) {
  const inicio = Math.floor(chaves.length * fracaoInicio)
  return chaves.slice(inicio, inicio + n)
}

function pesquisar(rootFolder, identifiers, userDataDir, maxDepth) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER)
    const t0 = Date.now()
    let picoRss = 0
    const amostra = setInterval(() => { picoRss = Math.max(picoRss, process.memoryUsage().rss) }, 200)

    worker.on('message', (msg) => {
      if (msg.type === 'done') {
        clearInterval(amostra)
        worker.terminate()
        resolve({
          ms: Date.now() - t0,
          encontrados: msg.stats.foundCount,
          naoEncontrados: msg.notFound.length,
          filesScanned: msg.stats.filesScanned,
          xmlAnalyzed: msg.stats.xmlAnalyzed,
          zipCount: msg.stats.zipCount,
          rarCount: msg.stats.rarCount,
          erros: msg.stats.errorCount,
          picoRssMb: Math.round(picoRss / 1024 / 1024),
          notas: msg.limitationNotes
        })
      }
    })
    worker.on('error', (e) => { clearInterval(amostra); reject(e) })
    worker.postMessage({ type: 'start', options: { rootFolder, identifiers, maxDepth, userDataDir } })
  })
}

function linha(nome, r) {
  const arqPorSeg = r.filesScanned > 0 ? Math.round(r.filesScanned / (r.ms / 1000)) : 0
  console.log(
    `${nome.padEnd(42)} ${String(r.ms + 'ms').padStart(9)} ` +
    `${String(r.filesScanned).padStart(8)} arq ` +
    `${String(arqPorSeg).padStart(7)} arq/s ` +
    `${String(r.picoRssMb + 'MB').padStart(7)} ` +
    `enc=${r.encontrados} nf=${r.naoEncontrados} err=${r.erros} zip=${r.zipCount} rar=${r.rarCount}`
  )
  if (r.notas.length) console.log('  notas:', r.notas.length, 'limitação(ões) registradas')
}

async function main() {
  const root = process.argv[2]
  const maxAmostras = Number(process.argv[3] || 200)
  // Por padrão pula o cenário de varredura completa (chave inexistente) — numa pasta de rede
  // grande de verdade isso pode passar de 1h. Passe --full para incluí-lo mesmo assim.
  const incluirVarreduraCompleta = process.argv.includes('--full')
  if (!root) {
    console.error('uso: node scripts/bench-real-folder.js "<pasta>" [maxAmostras] [--full]')
    process.exit(1)
  }

  console.log('Coletando chaves a partir dos NOMES dos arquivos (sem ler conteúdo)...')
  const t0 = Date.now()
  const { chaves, arquivos, pastas } = coletarTodasAsChaves(root)
  console.log(`arquivos=${arquivos} pastas=${pastas} chaves_no_nome=${chaves.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`)

  if (chaves.length === 0) {
    console.log('Nenhuma chave de 44 dígitos encontrada nos nomes dos arquivos — encerrando.')
    return
  }

  const ausente = '35249999999999000199550010000000099000000099'
  // Cenário realista: um lote de notas concentrado numa região da árvore (~40% do caminho de
  // varredura), não espalhado de propósito de ponta a ponta.
  const fracao = Number(process.env.BENCH_FRACAO || 0.05)
  const loteRealista = amostrarConcentrado(chaves, Math.min(10, chaves.length), fracao)

  console.log('cenario'.padEnd(42) + '     tempo   arquivos  throughput  memoria')
  console.log('-'.repeat(115))

  const ud = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bench-real-ud-'))

  linha(`${loteRealista.length} chaves (lote concentrado, uso típico)`, await pesquisar(root, loteRealista, ud(), 3))

  const compartilhado = ud()
  await pesquisar(root, loteRealista, compartilhado, 3)
  linha(`${loteRealista.length} chaves — repetida, via índice`, await pesquisar(root, loteRealista, compartilhado, 3))

  if (incluirVarreduraCompleta) {
    const amostra100 = amostrarEspalhado(chaves, Math.min(maxAmostras, chaves.length))
    linha(`${amostra100.length} chaves espalhadas (pior caso)`, await pesquisar(root, amostra100, ud(), 3))
    linha('1 chave inexistente (varre tudo)', await pesquisar(root, [ausente], ud(), 3))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
