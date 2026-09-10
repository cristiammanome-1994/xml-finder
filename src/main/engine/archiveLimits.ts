/**
 * Teto de tamanho descomprimido para extrair uma entrada de ZIP/RAR inteira em memória.
 *
 * Sem isso, uma entrada maliciosa poderia declarar um tamanho descomprimido enorme a partir de
 * poucos bytes comprimidos (zip bomb) e forçar alocação descontrolada de memória. Usado tanto
 * durante a busca (descida em arquivo compactado aninhado, em searchEngine.ts) quanto ao ler o
 * conteúdo de um resultado específico por fora da busca — "Ver XML"/"Extrair" (extractor.ts).
 * Esse segundo caminho existe porque um item pode ter sido encontrado por NOME, sem nunca ter seu
 * conteúdo lido durante a busca — o teto só entra em vigor nesse momento posterior.
 */
export const MAX_NESTED_ARCHIVE_BYTES = 200 * 1024 * 1024

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`
}
