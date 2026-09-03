# Auditoria do Projeto — XML Finder

Registro da auditoria técnica e das correções implementadas. Atualizado em 02/09/2026 (v1.6.0).

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

`npm test` — **43 testes, todos passando** (runner nativo do Node, sem framework externo).

| Módulo | Cobre |
|---|---|
| `pendingIdentifiers` | chave duplicada em formatos diferentes, lote com várias chaves, fuzzy por nome, piso anti-falso-positivo, consumo único |
| `xmlMatcher` | chave por `Id`/`chNFe`/44 dígitos crus, metadados por nota em lote, tipos de documento |
| `xmlEncoding` | ISO-8859-1 com acento, BOM, encoding desconhecido, chave legível em qualquer encoding |
| `streamScanner` | chave a megabytes do início, padrão partido na fronteira entre pedaços, parada antecipada |
| `keyUtils` | dígito verificador, normalização, parsing da lista colada |
| `classify` | assinatura de bytes de ZIP/RAR/XML |

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

## Débitos Técnicos

- `searchEngine.ts` continua sendo o arquivo mais denso do projeto (~660 linhas). A extração do
  matching aliviou a parte crítica; a orquestração de descida em ZIP/RAR ainda poderia sair.
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

## Próximos Passos

1. **Decisão pendente**: vale implementar duplicidade como modo de auditoria opt-in (mais lento,
   varre tudo), dado o trade-off acima? Ou deixar de fora do escopo da ferramenta?
2. Virtualização da tabela, **se** o volume de resultados justificar (medir antes).
3. ~~Testes de carga documentados com 100k+ arquivos~~ — feito; ver seção Testes.
4. Medir em pasta de rede (SMB) — bloqueado nesta rodada por falta de um caminho de rede acessível
   para medir de verdade. É o cenário em que a concorrência de leitura deve render mais.
5. Reavaliar `XML_READ_CONCURRENCY` (hoje 12) com base em medição em disco de rede e em HDD.
