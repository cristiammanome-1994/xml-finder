import { parentPort } from 'node:worker_threads'
import type { SearchOptions, SearchWorkerMessage } from '@shared/types'
import { runSearch } from './searchEngine'

if (!parentPort) {
  throw new Error('searchWorker deve ser executado como worker_thread')
}

let cancelled = false

parentPort.on('message', (msg: { type: string; options?: SearchOptions }) => {
  if (msg.type === 'cancel') {
    cancelled = true
  } else if (msg.type === 'start' && msg.options) {
    cancelled = false
    void execute(msg.options)
  }
})

async function execute(options: SearchOptions): Promise<void> {
  const post = (m: SearchWorkerMessage): void => parentPort!.postMessage(m)

  try {
    const result = await runSearch(options, {
      onProgress: (stats) => post({ type: 'progress', stats }),
      onFound: (item) => post({ type: 'found', item }),
      onError: (error) => post({ type: 'scan_error', error }),
      isCancelled: () => cancelled
    })
    post({ type: 'done', stats: result.stats, notFound: result.notFound, limitationNotes: result.limitationNotes })
  } catch (err) {
    post({
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
      limitationNotes: [`Erro inesperado na pesquisa: ${(err as Error).message}`]
    })
  }
}
