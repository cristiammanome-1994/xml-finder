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
- [ ] Detecção de duplicidade (mesma chave em dois locais). Hoje a busca para na primeira
      ocorrência, o que é correto para "onde está", mas não responde "quantas cópias existem".

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

## Próximos Passos

1. Detecção de duplicidade (P2) — barata agora que o índice existe: vira uma consulta agrupada.
2. Virtualização da tabela, **se** o volume de resultados justificar (medir antes).
3. Testes de carga documentados com 100k+ arquivos, para atualizar a seção "Escala testada" do README.
