export type ChangelogCategory = 'novidade' | 'melhoria' | 'correcao'

export interface ChangelogEntry {
  version: string
  date: string // YYYY-MM-DD
  title: string
  category: ChangelogCategory
  description: string
}

/**
 * Histórico de atualizações exibido no painel "Atualizações" da interface.
 * Mais recente primeiro — para registrar uma nova versão, adicione uma entrada no TOPO do array.
 * Ao lançar uma versão nova, lembre de manter esta lista e o campo "version" do package.json em sincronia.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.6.0',
    date: '2026-09-02',
    title: 'Correção importante em XMLs grandes, acentuação e acessibilidade',
    category: 'correcao',
    description:
      'Corrigido um problema sério: em arquivos XML muito grandes (acima de 20 MB, como lotes mensais com milhares de notas), a chave só era procurada no comecinho do arquivo — uma nota que estivesse mais adiante era informada como "não encontrada" mesmo estando lá. Agora esses arquivos são varridos por inteiro, sem consumir memória. Também corrigido: XMLs gerados em ISO-8859-1 (comum em emissores mais antigos) apareciam com acentuação corrompida na visualização; CT-e não era identificado corretamente; e o histórico de pesquisas podia ser perdido por inteiro se o aplicativo fosse fechado no momento exato em que ele era salvo. Pesquisas que localizam muitos XMLs ficaram bem mais rápidas de exibir, e toda a interface passou a funcionar por teclado (Tab para navegar, Enter para abrir, Esc para fechar).'
  },
  {
    version: '1.5.0',
    date: '2026-08-31',
    title: 'Índice de pesquisas e mais dados por nota encontrada',
    category: 'novidade',
    description:
      'Pesquisas repetidas na mesma pasta agora ficam quase instantâneas: o XML Finder guarda um índice local de "chave encontrada em tal lugar" e consulta ele antes de varrer o disco de novo — se nada mudou na pasta desde a última vez, o resultado vem na hora (aparece como "Via índice" no resumo da pesquisa; dá para limpar esse índice na tela de Histórico se a pasta mudou muito). Buscas em pastas de rede também ficam mais rápidas, já que várias verificações de arquivo agora acontecem em paralelo em vez de uma por vez. Além disso, cada nota fiscal encontrada agora mostra (e exporta para Excel/CSV) o CNPJ do emitente, número, série e data de emissão, extraídos corretamente mesmo em arquivos de lote com várias notas diferentes no mesmo XML.'
  },
  {
    version: '1.4.1',
    date: '2026-08-31',
    title: 'Proteções contra arquivos compactados maliciosos',
    category: 'correcao',
    description:
      'Um ZIP ou RAR aninhado que declarasse um tamanho descomprimido muito grande (a partir de poucos bytes reais) não era mais recusado antes de ser aberto, criando risco de consumo descontrolado de memória. Agora esse tipo de arquivo aninhado é ignorado com um aviso em vez de ser processado. A extração de um único XML também passou a validar explicitamente o nome do arquivo de destino, e selecionar uma pasta raiz inexistente (ou que não é mais uma pasta) agora mostra um erro claro em vez de falhar internamente.'
  },
  {
    version: '1.4.0',
    date: '2026-08-29',
    title: 'Painel de Atualizações',
    category: 'novidade',
    description:
      'Novo botão "Atualizações" no topo da tela, mostrando o histórico de mudanças do aplicativo — data, versão, categoria (nova funcionalidade, melhoria ou correção) e descrição de cada uma, da mais recente para a mais antiga. Uma bolinha no botão avisa quando há atualizações ainda não vistas.'
  },
  {
    version: '1.3.0',
    date: '2026-08-29',
    title: 'Correção de XMLs de lote',
    category: 'correcao',
    description:
      'Quando várias notas estavam dentro de um mesmo arquivo XML (enviNFe, ou vários nfeProc concatenados), apenas a primeira era localizada — as demais apareciam como "não encontrado" mesmo estando no arquivo. Agora todas as chaves presentes em um XML de lote são localizadas. A barra de progresso também passou a mostrar "N de M localizados" em vez de uma porcentagem que parecia ser o percentual da pasta já varrida.'
  },
  {
    version: '1.2.1',
    date: '2026-08-29',
    title: 'Ajustes de estabilidade',
    category: 'correcao',
    description:
      'Corrigido um toast que podia desaparecer antes da hora quando dois avisos com o mesmo texto apareciam em sequência rápida. Também removida duplicação de código de formatação entre componentes, sem mudança visível de comportamento.'
  },
  {
    version: '1.2.0',
    date: '2026-08-28',
    title: 'Correção crítica de performance em RAR e integridade do histórico',
    category: 'correcao',
    description:
      'A busca dentro de arquivos RAR com muitos XMLs era O(n²) — cada arquivo reabria e reescaneava o pacote inteiro do zero. Agora extrai tudo em uma única passada (RAR com 400 entradas: de potencialmente dezenas de segundos para ~225ms). Corrigidos também: histórico de uma pesquisa cancelada sendo salvo como se estivesse completa, corrupção ao reabrir o histórico durante uma busca em andamento, trava na interface se o motor de busca falhasse ao iniciar, e uma chave de acesso colada duas vezes com formatação diferente sumindo silenciosamente.'
  },
  {
    version: '1.1.0',
    date: '2026-08-28',
    title: 'Nova versão portable e visual padronizado',
    category: 'melhoria',
    description:
      'Adicionado um executável portable (sem instalação), além do instalador tradicional. Interface redesenhada para seguir o mesmo padrão visual do PMO Master: paleta de cores, tipografia e ícones consistentes, com novo alternador de tema claro/escuro. Abertura do aplicativo também ficou mais rápida — a biblioteca de exportação para Excel passou a carregar só quando usada, em vez de em todo início do programa.'
  },
  {
    version: '1.0.0',
    date: '2026-08-28',
    title: 'Lançamento inicial',
    category: 'novidade',
    description:
      'Primeira versão do XML Finder: localização de XMLs fiscais por chave de acesso ou nome de arquivo em pastas, subpastas, ZIP e RAR — inclusive arquivos compactados aninhados. Identificação por conteúdo do XML (chave/Id/chNFe) mesmo quando o nome do arquivo não corresponde, progresso em tempo real com cancelamento, exportação para Excel/CSV, extração de um único XML sem descompactar o resto, e histórico local de pesquisas. Processamento 100% local, sem envio de arquivos à nuvem.'
  }
]

export const LATEST_VERSION: string | null = CHANGELOG[0]?.version ?? null
