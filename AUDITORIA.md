# Auditoria do Projeto — XML Finder

Registro da auditoria técnica e das correções implementadas. Atualizado em 10/09/2026 (v1.9.0).

## Escopo real do projeto

Antes de qualquer conclusão, uma delimitação que muda o que faz e o que não faz sentido auditar aqui:

**XML Finder é uma ferramenta desktop de localização de arquivos.** Ela recebe uma lista de chaves
de acesso (ou nomes) e responde *"em qual pasta, ZIP ou RAR está cada XML"*. Ela **não** calcula
imposto, não apura, não valida escrituração e não interpreta regra tributária — ela lê o XML apenas
o suficiente para identificar de qual documento se trata.

Consequências para esta auditoria:

| Camada auditada | Existe no projeto? |
|---|---|
| Frontend (React/Electron renderer) | ✅ Sim — auditado |
| "Backend" (processo main + engine em worker thread) | ✅ Sim — auditado |
| Banco de dados | ⚠️ Parcial — SQLite local usado só como cache de pesquisa; sem modelo relacional de negócio |
| APIs / integrações externas | ❌ Não existe — aplicação 100% offline, por decisão de projeto |
| Regras de cálculo fiscal / tributário | ❌ Não existe — nenhuma alíquota, base de cálculo ou apuração |
| Reforma Tributária (CBS/IBS) | ❌ Sem superfície — a ferramenta é agnóstica ao conteúdo tributário do XML |

Onde o domínio fiscal **realmente** aparece — e onde a auditoria se concentrou — é na **leitura
correta do documento**: layout de chave de acesso, dígito verificador, identificação de modelo
(55/65/57/58), estrutura de XML de lote, encoding dos arquivos emitidos, e a consequência de um
falso "não encontrado" para quem depende da resposta.

> Não inventei regras tributárias nem "preparação para a Reforma" onde não há o que preparar —
> seria exatamente o tipo de alteração superficial que o pedido proíbe.

---

## Status

Diagnóstico: 🟡 → 🟢 **Os itens P0 e P1 identificados foram corrigidos.** A base já era sólida
(engine desacoplado, streaming em ZIP, tratamento de erro consistente); os problemas encontrados
eram localizados, e os mais graves estavam escondidos justamente nos caminhos menos exercitados
(arquivo muito grande, encoding legado, volume alto de resultados).

## P0 — Críticos

- [x] **Falso "não encontrado" em XML acima de 20MB.** A chave só era procurada nos primeiros 8KB
      do arquivo quando ele passava do teto de leitura em memória. Um lote de 25MB com a nota no
      fim era reportado como inexistente. *(o pior erro possível nesta ferramenta: leva a concluir
      que uma nota não está no acervo quando está)*

## P1 — Alta prioridade

- [x] **Leitura de conteúdo estritamente sequencial.** *(encontrado pelo teste de carga, não pela
      leitura de código)* O walker já lia metadados em paralelo desde a v1.5.0, mas a parte cara —
      abrir e ler cada XML — continuava um arquivo de cada vez. Medido: 10 mil XMLs em disco frio
      levavam ~100 s (≈99 arq/s), limitados por latência, não por CPU. Com 12 leituras em voo, o
      mesmo cenário caiu para menos de 1 s no melhor caso e ~10 s no pior.
- [x] **Uma transação SQLite por resultado encontrado.** O índice gravava cada acerto isoladamente,
      cada um com sua própria confirmação em disco, competindo com a varredura. Agora acumula e
      grava em lotes de 500 dentro de uma transação.
- [x] **`stat` redundante por resultado encontrado.** Para XML solto, o mtime necessário ao índice já
      tinha vindo do walker; o código consultava o disco de novo.
- [x] **XML em ISO-8859-1 exibido corrompido.** Todo conteúdo era decodificado como UTF-8; a chave
      (ASCII) era achada, mas razão social, endereço e descrição apareciam ilegíveis no visualizador.
- [x] **Perda silenciosa do histórico.** O arquivo era reescrito com `writeFile` direto; uma
      interrupção no meio deixava JSON truncado, e o carregador trata JSON inválido como "sem
      histórico" — apagando tudo sem aviso.
- [x] **O(n²) na acumulação de resultados.** Cada XML encontrado copiava o array inteiro e
      re-renderizava a tabela; degradava exatamente nas pesquisas grandes.
- [x] **Interface inacessível por teclado.** Abas de filtro, faixa de erros e linhas de resultado
      eram `div`/`tr` clicáveis, sem foco nem ativação por teclado; nenhum overlay fechava com Esc.
- [x] **CT-e nunca identificado.** A regex procurava `<infCTe>`, mas o schema real usa `<infCte>`.
      *(encontrado ao escrever os testes)*

## P1 — Alta prioridade (rodada 4, 10/09/2026 — auditoria multi-agente)

- [x] **Teto de zip bomb ausente no caminho "Ver XML"/"Extrair".** `extractor.ts` descia pela chain
      de ZIP/RAR sem nunca checar `MAX_NESTED_ARCHIVE_BYTES` — a proteção só existia durante a
      descida feita pela BUSCA em si. Um item encontrado por NOME (conteúdo nunca lido) podia
      apontar para uma entrada-bomba que só seria materializada ao abrir/extrair. Corrigido: o teto
      (extraído para `archiveLimits.ts`, compartilhado com `searchEngine.ts`) agora é checado em
      cada passo da chain, inclusive os intermediários.
- [x] **RAR aninhado extraído para memória antes do teto de profundidade descartá-lo.**
      `processRarEntries` só checava `depthRemaining <= 0` DEPOIS de já ter extraído o lote inteiro
      via `rar.readEntries()` — o caminho ZIP já fazia isso na ordem certa (checa antes de ler). Com
      profundidade padrão (3), um RAR no último nível com entradas logo abaixo do teto de tamanho
      era extraído por inteiro só para ser descartado em seguida. Corrigido: profundidade e tamanho
      são checados juntos, antes de montar o lote a extrair.
- [x] **Handlers IPC confiavam cegamente no `FileLocation`/caminho vindo do renderer.**
      `file:readXmlContent`, `file:extractSingle` e `shell:openContainingFolder` nunca validavam que
      o caminho pertencia a uma busca real. Um renderer comprometido (dependência maliciosa, bug
      futuro do Electron) podia pedir a leitura de qualquer arquivo do sistema, ou extrair conteúdo
      com nome controlado para qualquer pasta gravável (ex.: Startup do Windows). Corrigido com
      `PathScope` (novo, `src/main/pathScope.ts`, testável isoladamente): só aceita caminhos dentro
      de uma pasta já associada a uma busca real ou a uma entrada do histórico listada nesta sessão.
- [x] **Sniff de arquivo "outro" tipo (PDF de DANFe, TXT etc.) sem concorrência.** Diferente do
      `stat` e da leitura de XML (já paralelizados), `sniffFileKind` ainda processa um arquivo de
      cada vez — mesmo tipo de gargalo já corrigido nos outros dois casos, mas nesta terceira
      categoria. **Não implementado nesta rodada** — ver "Próximos Passos".

## P2 — Melhorias (rodada 4)

- [x] **CSV/Excel Formula Injection na exportação CSV.** Um XML malicioso na pasta pesquisada podia
      ter nome ou CNPJ extraído começando com `=`, `+`, `-` ou `@` — ao abrir o CSV exportado no
      Excel, isso é interpretado como fórmula (a exportação `.xlsx` via ExcelJS já era imune, por
      gravar tipo string explícito no OOXML). Corrigido: valor é prefixado com apóstrofo antes de
      escrever no CSV quando começa com um desses caracteres.
- [x] **6 ações assíncronas na UI sem tratamento de erro.** `copyPath`, `copyFullPath`, `openFolder`,
      `extract` (`ResultDetailDrawer.tsx`) e `handleExport`, `handleExportNotFound`
      (`ResultsTable.tsx`) não tinham `try/catch` — uma falha real (arquivo movido, disco cheio,
      `.xlsx` aberto no Excel, ou agora também uma rejeição do `PathScope`) virava promessa não
      tratada, sem nenhum aviso ao usuário. Corrigido: todas as seis agora mostram um toast de erro.
- [x] **`validateKey` (preload + handler IPC `key:validate`) era superfície morta.** Nenhum
      componente do renderer chamava — `IdentifiersInput.tsx` já validava localmente, sem IPC, por
      ser lógica pura. Removido dos dois lados.
- [x] **Reserialização completa e repetida do histórico durante o corte por tamanho.**
      `appendHistoryEntry` rodava no processo MAIN (não num worker) e fazia `JSON.stringify` do
      array inteiro a cada entrada removida no laço de corte — um histórico grande podia significar
      dezenas de reserializações completas de um payload de vários MB, bloqueando a janela do
      Electron. Corrigido: cada entrada é serializada uma vez só; o corte usa os tamanhos já
      calculados.
- [x] **Cópia dupla do buffer ao abrir RAR.** `buffer.buffer.slice(...)` sempre copiava o
      `ArrayBuffer` inteiro, mesmo quando o `Buffer` já ocupava o `ArrayBuffer` por completo (caso
      comum de `fs.readFile` para arquivos RAR reais, > 8KB). Corrigido: copia só quando o `Buffer`
      é de fato uma view parcial de um `ArrayBuffer` maior.

## P2 — Melhorias

- [x] **Testabilidade do motor de busca.** As regras de casamento estavam presas em closures dentro
      de uma função de ~600 linhas, impossíveis de testar isoladamente. Extraídas para
      `PendingIdentifiers`.
- [x] **Suíte de testes automatizados.** De zero para 43 testes (`npm test`, runner nativo do Node,
      sem dependência nova).
- [x] Numeração duplicada no estado inicial ("1. 1. Selecione a pasta raiz").
- [ ] Virtualização da tabela de resultados (hoje ~2s para 10.000 linhas; decisão consciente
      documentada no README — só vale a pena se o volume de *resultados* crescer).
- [ ] **Detecção de duplicidade — tentada e revertida em 03/09, ver nota abaixo.** Precisa de decisão
      de escopo antes de tentar de novo.

## P3 — Futuro

- [ ] Suporte a RAR multivolume (limitação da biblioteca WASM).
- [ ] Senha em arquivos compactados (hoje reportado como erro e pulado).
- [ ] Assinatura digital do instalador (custo de certificado).

---

## Melhorias Implementadas

### Motor de busca (engine)

**Varredura em streaming de arquivos grandes** — `streamScanner.ts` (novo)
O arquivo é lido em pedaços de 1MB com 1KB de sobreposição entre eles, para que um padrão que caia
exatamente na fronteira entre dois pedaços não passe despercebido. A leitura para assim que todos os
identificadores procurados são resolvidos. Um lote de 25MB com a chave no final resolve em ~180ms.
Os metadados por nota não são extraídos nesse modo (um bloco `<infNFe>` pode ser maior que o pedaço),
e isso é informado ao usuário como limitação, em vez de omitido silenciosamente.

**Decodificação por encoding declarado** — `xmlEncoding.ts` (novo)
Lê o `encoding=` do prólogo (com precedência para BOM) e decodifica de acordo, caindo para UTF-8 em
rótulo desconhecido sem nunca lançar exceção.

**Regras de casamento isoladas** — `pendingIdentifiers.ts` (novo)
Concentra a parte mais sutil do domínio: mesma chave colada em formatações diferentes gerando dois
resultados, lote satisfazendo várias chaves de uma vez, casamento fuzzy por nome consumindo no
máximo um identificador por arquivo, e o piso de 6 caracteres que evita falso positivo por substring.

**Correção de identificação de CT-e** — `xmlMatcher.ts`
`<infCTe>` → `<infCte>`. Antes, todo CT-e caía em "Desconhecido".

### Frontend

- Resultados aplicados ao estado **em lote** (buffer de 150ms), com descarga forçada antes de
  finalizar para o histórico não perder nada em trânsito.
- Abas de filtro e faixa de erros viraram `<button>`; linhas de resultado ganharam `tabIndex`,
  `role` e ativação por Enter/Espaço.
- Overlays com `role="dialog"`, `aria-modal` e rótulo; botões de ícone com `aria-label`.
- `useEscapeKey` — fechar com Esc nos cinco overlays (o drawer cede a vez ao visualizador de XML
  quando este está por cima).
- Indicador de foco visível (`:focus-visible`), sem poluir a navegação por mouse.

### Banco / armazenamento local

Não há banco de negócio. Duas correções no armazenamento local existente:

- **Histórico**: escrita atômica (arquivo temporário + `rename`), eliminando a janela em que uma
  interrupção apagava todo o histórico.
- **Índice de pesquisa** (SQLite via `node:sqlite`): migração idempotente de colunas para bancos
  criados por versões anteriores, sem exigir recriação.

Sobre índices: **não foram criados índices novos**. A tabela do cache usa chave primária composta
`(root_folder, access_key)`, que já é exatamente o acesso feito na consulta. Um índice adicional
custaria escrita sem servir a nenhuma query existente.

### Fiscal

O que existe de domínio fiscal aqui é **identificação de documento**, e foi tratado como tal:

- Validação de chave de acesso por dígito verificador (módulo 11) — já existia, agora coberta por testes.
- Identificação de modelo pela posição 21-22 da chave (55 NF-e, 65 NFC-e, 57 CT-e, 58 MDF-e).
- Extração de CNPJ do emitente, número, série e data de emissão **por bloco `<infNFe>`**, e não do
  arquivo como um todo — em XML de lote isso é a diferença entre atribuir o CNPJ certo a cada nota
  ou misturar os dados de notas diferentes.
- Reconhecimento de XML de lote (`enviNFe`, múltiplos `nfeProc` concatenados) como portador de várias
  notas, e não de uma só.

Nenhuma alíquota, base de cálculo ou apuração foi implementada — não é o escopo da ferramenta.

---

## Arquitetura

Nenhuma mudança estrutural foi necessária. A separação existente (renderer ↔ IPC ↔ main ↔ worker
thread ↔ engine sem conhecimento da interface) se mostrou correta e foi mantida.

As duas mudanças arquiteturais foram **extrações**, não reescritas:
`PendingIdentifiers` (estado de identificadores pendentes) e `XmlCandidate` (objeto substituindo
quatro callbacks posicionais). Ambas motivadas por testabilidade concreta, não por gosto.

Decisões deliberadas de **não** fazer:

- Não criar indexador completo antecipado da pasta (varreria tudo mesmo sem necessidade, e anularia
  a saída antecipada da busca). O cache oportunista atual cobre o caso real: pesquisas repetidas.
- Não paralelizar com múltiplos workers/processos — o gargalo é I/O, não CPU; a concorrência
  limitada de `stat` já endereça o caso das pastas de rede.
- Não introduzir framework de teste — o runner nativo do Node cobre tudo o que é preciso, sem
  dependência adicional para manter.

## Testes

`npm test` — **80 testes, todos passando** (runner nativo do Node, sem framework externo).

| Módulo | Cobre |
|---|---|
| `pendingIdentifiers` | chave duplicada em formatos diferentes, lote com várias chaves, fuzzy por nome, piso anti-falso-positivo, consumo único |
| `xmlMatcher` | chave por `Id`/`chNFe`/44 dígitos crus, metadados por nota em lote, tipos de documento |
| `xmlEncoding` | ISO-8859-1 com acento, BOM, encoding desconhecido, chave legível em qualquer encoding |
| `streamScanner` | chave a megabytes do início, padrão partido na fronteira entre pedaços, parada antecipada |
| `keyUtils` | dígito verificador, normalização, parsing da lista colada |
| `classify` | assinatura de bytes de ZIP/RAR/XML |
| `history` *(novo, rodada 4)* | round-trip, ordem mais-recente-primeiro, corte por tamanho mantendo a entrada nova, serialização incremental byte-a-byte idêntica ao `JSON.stringify` ingênuo, teto de 50 entradas, `clearHistory` |
| `pathScope` *(novo, rodada 4)* | caminho fora de qualquer pasta conhecida rejeitado, dentro aceito (raiz e subpasta), fronteira de separador (`/notas2` não casa com `/notas`), múltiplas pastas (busca ao vivo + histórico), case-insensitive no Windows / case-sensitive fora dele, caminho relativo resolvido |
| `extractor` *(novo, rodada 4)* | leitura normal solta e em ZIP, **zip bomb rejeitado** (tamanho declarado acima do teto, inclusive em passo intermediário da chain), entrada inexistente, `extractSingleFile` grava/evita sobrescrita/barra `..`/reduz a basename |
| `exporter` *(novo, rodada 4)* | CSV formula injection neutralizado (`=`,`+`,`-`,`@`), valor normal sem prefixo, `=` no meio do valor não afetado, item não encontrado exporta sem lançar |

### Teste de carga — `scripts/bench.js`

Harness que gera um acervo sintético e mede o worker real. Resultados com **100.000 XMLs** estão no
README. Os três achados que importam:

1. **Memória não cresce com o acervo** — 10x mais arquivos (10k → 100k) levou o pico de ~81 MB para
   ~129 MB, e o que cresce é o acúmulo de resultados, não a varredura. Valida o desenho em streaming
   do walker.
2. **Tempo linear**, ~2.000 arquivos/s sustentados. Sem comportamento quadrático escondido.
3. **Pesquisa repetida via índice independe do tamanho do acervo** — ~0,51 s com 10k arquivos e
   ~0,55 s com 100k. É exatamente o que o índice deveria entregar, agora comprovado.

**Sobre a confiabilidade da medição** — vale registrar porque afetou as conclusões: nas primeiras
rodadas, o mesmo cenário oscilou entre ~950 ms e ~7.300 ms *sem nenhuma mudança de código*. Cheguei a
formular a hipótese de um "custo por resultado encontrado" de ~4,8 ms a partir de uma única rodada;
repetindo a medição, a hipótese caiu — era ruído de cache de sistema de arquivos e antivírus. Por
isso o benchmark passou a repetir cada cenário e reportar mínimo, mediana e máximo. A lição vale para
as próximas medições neste projeto: **uma rodada única aqui não é evidência.**

Validações adicionais executadas nesta rodada (fora da suíte, por exigirem arquivos reais):

- Regressão ponta a ponta com worker real — 12 verificações: XML solto, lote, dentro de ZIP,
  casamento por nome, ISO-8859-1, XML corrompido não interrompendo a busca, chave ausente
  corretamente reportada, e segunda pesquisa resolvida 100% pelo índice sem tocar no disco.
- Lote de 25MB com a chave no final: encontrada (antes, não era).
- Renderer carregado no Electron: sem erros de console, nenhum botão sem nome acessível,
  `:focus-visible` presente, layout conferido por captura de tela.

## Rodada 4 — Auditoria multi-agente (10/09/2026)

Pedido do usuário: rodar os subagents especializados adicionados em `.claude/agents/` (sessão
anterior) contra o projeto, priorizando por Crítico/Alto/Médio/Baixo, e implementar o que tivesse
boa relação impacto×risco.

**Achado de infraestrutura, registrado por transparência**: os 14 arquivos `.md` em
`.claude/agents/` **não são reconhecidos** como `subagent_type` pela ferramenta de agentes deste
ambiente — só os tipos embutidos (`general-purpose`, `Explore`, `Plan` etc.) funcionam. Adaptei
despachando 4 revisões via `general-purpose`, injetando no prompt a persona e o foco de cada
agente (`code-reviewer`, `security-auditor`, `performance-engineer`, `architect-reviewer`), cada
uma isolada em worktree próprio, modo somente-leitura, instruída a ler este arquivo primeiro para
não repetir achados já corrigidos. Os `.md` em si continuam no repositório como documentação do
critério de seleção (ver README), mas não são "plugins" ativos neste ambiente especificamente.

**Implementado nesta rodada** (ver P1/P2 acima para a lista com detalhe técnico): teto de zip bomb
também no caminho "Ver XML"/"Extrair" (antes só valia durante a busca), ordem de checagem de
profundidade corrigida na descida em RAR (mesmo padrão que o ZIP já tinha certo), validação de
caminho vindo do renderer via `PathScope`, CSV formula injection, 6 handlers de UI sem tratamento
de erro, superfície de IPC morta (`validateKey`) removida, reserialização repetida do histórico, e
cópia dupla evitável do buffer de RAR.

**Implementado em seguida, mesmo dia (10/09/2026, segunda leva)**:

- [x] **Concorrência no sniff de arquivo "outro" tipo.** `sniffFileKind` (PDF de DANFe, TXT, sem
      extensão) agora roda no mesmo tipo de pool com janela de concorrência (`SNIFF_CONCURRENCY = 12`)
      já usado para XML. Zip/rar detectados por sniff (raro — extensão errada ou ausente) são
      processados dentro da própria tarefa de sniff, sem esperar outras tarefas de sniff/XML em
      voo primeiro — concessão deliberada e documentada no código, aceitável porque esse caso é raro
      e bounded pela própria janela de concorrência. Arquivos ZIP/RAR de extensão CONHECIDA continuam
      esvaziando XML e sniff em voo antes de abrir, sem mudança de comportamento aí. Handlers de
      ZIP/RAR extraídos para funções reutilizáveis (`handleDiskZip`/`handleDiskRar`) para servir os
      dois caminhos (extensão conhecida e sniff) sem duplicar lógica. Testado com 90+ arquivos
      "outro" simulados (PDF fake) misturados a XML/ZIP reais, incluindo um ZIP e um XML disfarçados
      sem extensão reconhecível — todos corretamente classificados e processados, sem erro.
      **Não medido com benchmark dedicado** (segue o mesmo padrão já comprovado para XML/`stat`, não
      remedido isoladamente — evita reafirmar "uma rodada única não é evidência" sem repetição real).
- [x] **Normalização de acento/caixa no casamento genérico por conteúdo.** Adicionada
      `normalizeForContentMatch` (`keyUtils.ts`) — normaliza SÓ caixa/acento, preservando pontuação e
      espaços (ao contrário de `normalizeForNameMatch`, que remove tudo). Aplicada nos dois pontos de
      `PendingIdentifiers.takeGenericByContent` (busca normal e streaming). Testado explicitamente
      que a correção NÃO introduz o falso positivo que motivou adiá-la: `<a>ABC</a><b>DEF</b>`
      continua sem casar com o identificador `ABCDEF`, porque a estrutura do XML não é removida.

**Ainda documentado, não implementado** (custo/risco não justificou nesta rodada, ou é decisão de
produto):

- Concorrência entre subpastas irmãs no `walkDir` (`fsWalker.ts`) — hoje a listagem de uma subpasta
  só começa depois que a árvore inteira da anterior termina. Mesmo tipo de gargalo que motivou a
  janela de `stat`, um nível acima, mas mais arriscado de implementar (`walkDir` é um gerador
  recursivo; paralelizar irmãos exige mesclar múltiplos geradores assíncronos, não só uma janela de
  promessas como no sniff/XML). Adiado para não arriscar o percurso principal sem tempo dedicado.
- `fsWalker.ts` usa `shift()` (FIFO) em vez de `Promise.race` na janela de concorrência de `stat` —
  head-of-line blocking sob latência desigual (pasta de rede); `searchEngine.ts` já usa a técnica
  melhor para XML solto, no mesmo arquivo de engine.
- `ResultsTable`/`SummaryStats` recalculam o array de resultados inteiro a cada flush de 150ms (3-4
  passagens O(n) em vez de 1) — baixo risco prático hoje (mesmo teto de ~10k já medido), mas é o
  mesmo tipo de custo que motivou o buffer original.
- Mover a validação de "pasta raiz existe e é diretório" de `main/index.ts` para dentro de
  `runSearch` (engine) — hoje só existe no processo Electron; se o motor for reusado por outro
  consumidor (CLI, conforme o README já cogita), essa validação não viria de graça.
- `exportToExcel` mantém o workbook inteiro em memória (`ExcelJS.Workbook` em vez de
  `WorkbookWriter` em streaming) — só relevante se o volume exportado for muito além do que já foi
  testado (~10k linhas).
- Tipos mortos/estado impossível em `shared/types.ts`: `ChainStep.entrySize` nunca lido por ninguém,
  `ScanError.kind: 'encoding'` nunca emitido (por desenho — `xmlEncoding.ts` nunca lança), `FoundItem.
  matchMethod` permite o valor `'nao_encontrado'` que semanticamente não deveria ocorrer ali.
  Cosmético, registrado para limpeza futura.
- `fmtSize` (renderer) não formata MB — um resultado de 25MB aparece como "25600.0 KB".
- Vulnerabilidades de `npm audit` (4: 2 moderate, 2 high) — `extract-zip`/`uuid` são transitivas
  (electron/exceljs, risco real baixo para este app offline); a que pesa é o Electron estar 6
  versões majors atrás (38 → 44 disponível). Upgrade de Electron é decisão de escopo/risco alto
  (mudança de API entre majors, precisa de retestar a app inteira) — não é algo para decidir
  sozinho numa correção pontual. Recomendado como iniciativa própria, não implementado aqui.

## Débitos Técnicos

- `searchEngine.ts` continua sendo o arquivo mais denso do projeto (~660 linhas). A extração do
  matching aliviou a parte crítica; a orquestração de descida em ZIP/RAR ainda poderia sair — mas a
  revisão de arquitetura da rodada 4 concluiu que não vale a pena SEM um segundo motivo de reuso
  concreto (ex.: o modo de auditoria de duplicidade, se algum dia for aprovado).
- Tabela de resultados sem virtualização (aceitável até ~10k linhas, medido).
- RAR ainda é lido inteiro em memória — limitação da biblioteca WASM, não do nosso código.
- Metadados por nota não disponíveis no modo de varredura de arquivo grande.

## Tentativa revertida: detecção de duplicidade via índice (03/09/2026)

Implementei e depois reverti — antes de qualquer commit — uma versão de detecção de duplicidade que
usava o índice de pesquisa (SQLite) para lembrar todo local onde uma chave já apareceu, e avisar
quando o local atual não era o único. Parecia barata, exatamente como o passo anterior desta lista
sugeria. Um teste com dois cenários controlados mostrou que o desenho não funciona:

- **Falso positivo**: renomear/mover um arquivo (cenário comum e inofensivo) fazia a próxima busca
  acusar "duplicidade", apontando para o caminho antigo que não existe mais.
- **Falso negativo**: com duas cópias REAIS e simultâneas da mesma chave na mesma pasta, a busca
  nunca detectava a segunda — porque a saída antecipada (parar assim que a chave é resolvida) impede
  a segunda cópia de sequer ser lida, em qualquer número de repetições da busca.

A causa raiz: a saída antecipada — uma característica correta e deliberada do motor, validada por
benchmark — é estruturalmente incompatível com "notar quando a mesma chave aparece de novo", porque
ela existe justamente para parar de procurar assim que a chave é resolvida. Um índice que só registra
"a última vez que vi isso" não consegue diferenciar "essa chave mudou de lugar" de "essa chave existe
em dois lugares ao mesmo tempo" — são o mesmo sintoma (duas gravações, locais diferentes) com causas
opostas.

Detecção de duplicidade real exigiria um modo de busca genuinamente diferente — que **não** pare na
primeira ocorrência de cada chave, e sim continue varrendo a pasta inteira mesmo depois de tudo
resolvido, só para confirmar unicidade. Isso é mais lento por design (perde a otimização que motivou
boa parte do trabalho de performance desta auditoria) e muda o modelo de resultado (uma chave pode
gerar mais de um "encontrado"). Não é um bug a corrigir — é uma feature nova, com um trade-off de
desempenho que caberia ao usuário decidir se quer pagar, provavelmente como uma ação separada
("Auditar duplicidade nesta pasta") em vez de comportamento automático de toda busca.

## Medição em pasta de rede real (03/09/2026)

Com autorização do usuário, medi contra uma pasta de produção real numa unidade de rede mapeada
(414.912 arquivos, 414.412 XMLs, 451 RAR, ~34,3 GB). Só leitura — nada foi escrito ou alterado
naquela pasta; identificadores de amostra vieram dos NOMES dos arquivos, sem ler conteúdo de nenhum
XML real. Ferramenta: `scripts/bench-real-folder.js` (novo, mesmo espírito do `bench.js`, mas nunca
gera dados na pasta alvo).

**Achado 1 — varredura completa é impraticável nessa pasta**: uma busca por chave inexistente
(força varrer tudo) passou de 1h28min sem terminar; interrompida a pedido do usuário. Para
comparação, o equivalente com 100.000 arquivos sintéticos em disco local levava ~50s. Durante a
espera, o processo mostrou CPU baixa e constante (~20%) e memória subindo/descendo de forma
consistente com carregar e liberar um RAR grande — ou seja, estava progredindo de verdade, só que
a maior parte do tempo é espera de rede, não processamento.

**Achado 2 — o caso de uso real (lote pequeno) é rápido, e o índice entrega o prometido**: buscando
10 chaves reais concentradas numa região da árvore (uso típico — um contador procurando um lote
específico, não a base inteira), a busca resolveu tudo em ~11,1s abrindo um único ZIP encontrado no
caminho. Repetindo a MESMA busca (via índice): **121ms — cerca de 92x mais rápido, zero arquivos
revarridos**. Esse é o cenário de uso mais comum (buscar de novo, ou continuar no dia seguinte) e é
exatamente onde o índice deveria brilhar.

**Não confirmado**: um cenário com muitas chaves espalhadas em XMLs SOLTOS (não dentro de um único
compactado) exigiria varrer uma fração grande da árvore nesta pasta específica — na prática, custaria
tempo comparável ao Achado 1. Por isso não cheguei a comparar `XML_READ_CONCURRENCY` (hoje 12) contra
um valor maior nesta pasta; ficou como próximo passo caso o usuário quiser investir outra rodada.

## Próximos Passos

1. **Decisão pendente**: vale implementar duplicidade como modo de auditoria opt-in (mais lento,
   varre tudo), dado o trade-off documentado acima na seção de duplicidade? Ou deixar de fora do
   escopo da ferramenta?
2. Virtualização da tabela, **se** o volume de resultados justificar (medir antes).
3. ~~Testes de carga documentados com 100k+ arquivos~~ — feito; ver seção Testes.
4. ~~Medir em pasta de rede (SMB)~~ — feito nesta rodada; ver seção acima. Resultado: uso típico
   (lote pequeno) é rápido, índice funciona muito bem; varredura completa é impraticável nesta pasta
   específica, mas isso é esperado dado o volume (415k arquivos, 34GB) e não chega a ser um problema
   do programa em si — é o custo real de acessar 415 mil arquivos individuais por rede.
5. Testar `XML_READ_CONCURRENCY` mais alto especificamente contra XMLs soltos em rede (não dentro de
   compactado) — não foi possível isolar esse caminho nesta pasta sem outra rodada longa.
6. ~~Concorrência no sniff de arquivo "outro" tipo~~ — feito (10/09/2026, segunda leva da rodada 4).
   Falta ainda a concorrência entre subpastas irmãs no `walkDir` (mais arriscada — gerador recursivo,
   exigiria mesclar geradores assíncronos em vez de só uma janela de promessas).
7. ~~Normalização acento/caixa no casamento genérico por conteúdo~~ — feito (10/09/2026, segunda leva
   da rodada 4), com o desenho conservador (só caixa/acento) para não introduzir o falso positivo.
8. Avaliar upgrade do Electron (38 → 44 disponível) — decisão de escopo/risco que exige retestar a
   app inteira, não algo para decidir numa correção pontual.
