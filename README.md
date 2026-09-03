# XML Finder

Aplicação desktop (Windows) para localizar rapidamente XMLs fiscais — principalmente NF-e — em grandes volumes de documentos: pastas, subpastas, arquivos `.zip`, arquivos `.rar` e combinações aninhadas desses formatos.

Feita para o cenário em que alguém tem uma lista de chaves de acesso (ou nomes de arquivo) e precisa descobrir exatamente em qual pasta, ZIP ou RAR cada XML está — sem abrir centenas de arquivos compactados manualmente.

> 🔒 100% local. Nenhum arquivo é enviado para a internet — toda a busca, leitura e extração acontece na sua máquina.

## Download

Baixe a versão mais recente em **[Releases](../../releases/latest)**:

| Arquivo | Uso |
|---|---|
| `XML Finder Setup X.Y.Z.exe` | Instalador padrão (cria atalho, permite escolher pasta de instalação) |
| `XML Finder-X.Y.Z-portable.exe` | Executável único, roda direto sem instalar nada |

> ⚠️ **Aviso do Windows SmartScreen**: como o instalador ainda não tem certificado de assinatura de código (pago), o Windows pode avisar "O Windows protegeu o seu PC". Isso é normal para ferramentas internas não publicadas — clique em **"Mais informações" → "Executar assim mesmo"**.

## Funcionalidades

- **Busca por chave de acesso (44 dígitos) ou por nome/trecho do nome do arquivo**, colando uma ou milhares de linhas de uma vez.
- **Valida a chave de acesso** (dígito verificador módulo 11) e mostra na hora quantas são válidas, inválidas ou identificadores por nome.
- **Procura em pastas, subpastas, ZIP e RAR**, inclusive **arquivos compactados aninhados** (ex.: `.zip` dentro de `.rar` dentro de `.zip`), com profundidade configurável (1, 2, 3, 5 ou ilimitada — padrão 3).
- **Identifica o XML pelo conteúdo**, não só pelo nome: procura `chNFe`, o atributo `Id="NFe..."` e a chave de 44 dígitos dentro do arquivo — encontra mesmo quando o nome do arquivo não bate com a chave.
- **Lê arquivos de qualquer tamanho**: XMLs de lote acima de 20 MB são varridos em streaming, por pedaços, em vez de carregados em memória — a chave é encontrada em qualquer ponto do arquivo.
- **Respeita o encoding do XML** (UTF-8 ou ISO-8859-1), preservando acentuação de razão social e endereço na visualização.
- **Navegável por teclado**: Tab para percorrer, Enter/Espaço para abrir um resultado, Esc para fechar painéis.
- **Detecta XML, ZIP e RAR por assinatura de conteúdo**, não só pela extensão (pega arquivos renomeados ou sem extensão).
- **Não extrai arquivos compactados inteiros**: lê apenas as entradas necessárias via streaming (ZIP) ou extração seletiva (RAR).
- **Sai da busca assim que todas as chaves são encontradas**, sem varrer o resto da pasta — importante em bases com arquivos muito grandes.
- **Progresso em tempo real** (arquivos analisados, XMLs analisados, ZIPs, RARs, encontrados, tempo decorrido) com botão de cancelar.
- **Resultados filtráveis** (Todos / Encontrados / Não encontrados / Erros) com resumo (dentro de ZIP, dentro de RAR, em pastas soltas).
- Para cada XML encontrado: **copiar caminho**, **copiar caminho completo** (incluindo caminho interno no ZIP/RAR), **abrir a pasta no Explorer**, **extrair só aquele XML** (sem descompactar o resto) e **visualizar o XML formatado**.
- **Exportação para Excel e CSV** dos resultados (incluindo CNPJ do emitente, número, série e data de emissão de cada nota), e exportação separada só dos **não encontrados**.
- **Histórico de pesquisas** local, com opção de reabrir uma pesquisa anterior.
- **Índice local de pesquisas repetidas**: a cada busca, o app lembra onde cada chave foi encontrada na pasta; pesquisar de novo pela mesma chave na mesma pasta (sem que ela tenha mudado) responde quase instantaneamente, sem varrer o disco de novo.
- **Tema claro/escuro**, alternável e persistido entre sessões.
- Continua a busca mesmo diante de **ZIP/RAR corrompido, XML malformado, arquivo protegido por senha ou sem permissão de leitura** — registra como erro e segue em frente.
- Recusa descompactar entradas de ZIP/RAR aninhadas com tamanho descomprimido acima de 200MB, evitando consumo descontrolado de memória diante de arquivos compactados maliciosos ("zip bomb").

## Como usar

1. Selecione a pasta raiz onde os XMLs (soltos ou compactados) estão.
2. Cole as chaves de acesso e/ou nomes de arquivo que quer localizar (uma por linha, ou separadas por vírgula/espaço).
3. Ajuste a profundidade de arquivos compactados aninhados, se precisar.
4. Clique em **LOCALIZAR XMLs** e acompanhe o progresso.
5. Filtre os resultados, clique em um item encontrado para ver detalhes e ações.
6. Exporte os resultados (ou só os não encontrados) quando terminar.

## Arquitetura

Aplicação Electron (processo principal em Node.js + janela renderer em React), com o motor de busca rodando em um **worker thread** separado para a interface nunca travar durante buscas grandes.

```
src/
├── main/                    # Processo principal (Node.js / Electron)
│   ├── index.ts             # Criação da janela, handlers de IPC, diálogos do SO
│   ├── env.ts
│   └── engine/               # Motor de busca — independente da interface
│       ├── searchWorker.ts   # Entrypoint do worker_thread
│       ├── searchEngine.ts   # Orquestrador: varredura + matching + progresso + cancelamento
│       ├── fsWalker.ts       # Percorre a árvore de pastas (streaming, sem carregar tudo em memória)
│       ├── classify.ts       # Classifica arquivo por extensão e/ou assinatura de bytes
│       ├── zipReader.ts      # Leitura de ZIP em streaming (yauzl) — sem extrair tudo
│       ├── rarReader.ts      # Leitura de RAR via WASM (node-unrar-js) — sem depender de unrar.exe
│       ├── xmlMatcher.ts     # Extração de chave/Id/CNPJ/número/série/data por nota, via regex leve
│       ├── pendingIdentifiers.ts # Regras de casamento identificador <-> arquivo (testável isoladamente)
│       ├── streamScanner.ts  # Varredura por pedaços de XML grande demais para caber em memória
│       ├── xmlEncoding.ts    # Decodificação respeitando o encoding declarado (UTF-8 / ISO-8859-1)
│       ├── extractor.ts      # Extração de um único arquivo de dentro de ZIP/RAR aninhados
│       ├── searchIndex.ts    # Cache local (SQLite via node:sqlite) de "chave -> onde foi achada"
│       ├── exporter.ts       # Exportação para Excel/CSV (carregado sob demanda)
│       └── history.ts        # Histórico de pesquisas (JSON local)
├── preload/
│   └── index.ts             # Ponte segura (contextBridge) entre main e renderer
├── renderer/                 # Interface (React + Vite)
│   └── src/
│       ├── App.tsx
│       ├── store.ts          # Estado global (zustand)
│       ├── styles.css        # Design tokens (cores, raio, tipografia)
│       └── components/
└── shared/
    ├── types.ts              # Tipos compartilhados entre main, preload, renderer e engine
    └── keyUtils.ts           # Normalização de identificadores e validação de chave NF-e
```

**Por que essa separação:** o motor de busca (`main/engine`) não conhece a interface — ele recebe uma pasta raiz, uma lista de identificadores e opções, e emite eventos de progresso/encontrado/erro. Isso deixa a lógica de busca testável isoladamente e pronta para uma futura integração diferente (CLI, outra UI, etc.), como previsto desde o desenho inicial do projeto.

### Stack técnica

| Camada | Tecnologia |
|---|---|
| Runtime desktop | [Electron](https://www.electronjs.org/) |
| Interface | React 18 + [zustand](https://github.com/pmndrs/zustand) (estado) |
| Build | [electron-vite](https://electron-vite.org/) (Vite) + TypeScript |
| Leitura de ZIP | [yauzl](https://github.com/thejoshwolfe/yauzl) (streaming, entrada por entrada) |
| Leitura de RAR | [node-unrar-js](https://github.com/YuJianrong/node-unrar.js) (WASM, sem `unrar.exe` externo) |
| Índice/cache local | [`node:sqlite`](https://nodejs.org/api/sqlite.html) (nativo do Node/Electron, sem dependência extra) |
| Exportação | [exceljs](https://github.com/exceljs/exceljs) (Excel), gerador CSV próprio |
| Ícones | [lucide-react](https://lucide.dev/) |
| Fonte | [Geist](https://vercel.com/font) (empacotada localmente, sem depender de rede) |
| Empacotamento | [electron-builder](https://www.electron.build/) (NSIS + portable) |

### Motor de busca, em resumo

1. Percorre a pasta raiz uma única vez (não faz uma varredura completa por identificador).
2. Para cada arquivo: classifica por extensão e, se necessário, por assinatura de bytes (`PK\x03\x04` para ZIP, `Rar!` para RAR, `<?xml`/`<` para XML — mesmo sem a extensão correta).
3. XML solto ou dentro de ZIP/RAR: primeiro tenta casar pelo **nome** (chave de 44 dígitos extraída do nome, ou trecho de nome); se não achar, lê um trecho do **conteúdo** (com fallback para o arquivo inteiro se necessário) e procura a chave de acesso.
4. ZIP/RAR encontrados dentro de outro ZIP/RAR são abertos recursivamente até a profundidade configurada, sempre a partir de um buffer em memória — nunca extraindo o arquivo compactado inteiro para disco.
5. Um mesmo arquivo pode satisfazer vários identificadores de uma vez — XMLs de lote (`enviNFe`, vários `nfeProc` concatenados) carregam dezenas de notas, e todas as chaves procuradas presentes nele são localizadas, cada uma com seu próprio CNPJ/número/série/data (extraídos por nota, não do arquivo como um todo).
6. Assim que todas as chaves pedidas são encontradas, a busca para imediatamente (não continua varrendo o resto da base).
7. Antes de varrer o disco, cada chave é checada contra o índice local dessa pasta; se já foi encontrada numa busca anterior e o arquivo/contêiner onde estava não mudou (mesmo mtime), o resultado vem direto do índice sem tocar no disco.

## Escala testada

Medições reais (não estimativas), reproduzíveis com `scripts/bench.js`.

**Acervo sintético de 100.000 XMLs** (~2,7 KB cada, em 360 subpastas ano/mês/dia), 3 repetições por
cenário, reportando o menor tempo:

| Cenário | Tempo | Vazão | Memória (pico) |
|---|---|---|---|
| 1 chave, a última do acervo (pior caso) | ~48 s | ~2.070 arq/s | 129 MB |
| 1 chave inexistente (varre tudo) | ~49 s | ~2.040 arq/s | 131 MB |
| 100 chaves espalhadas | ~50 s | ~1.990 arq/s | 132 MB |
| 1.000 chaves espalhadas | ~52 s | ~1.940 arq/s | 135 MB |
| 10.000 chaves espalhadas | ~52 s | ~1.940 arq/s | 141 MB |
| **1.000 chaves, pesquisa repetida (via índice)** | **~0,55 s** | — | 130 MB |

O que esses números mostram:

- **A memória não cresce com o tamanho do acervo.** De 10.000 para 100.000 arquivos (10x), o pico
  saiu de ~81 MB para ~129 MB — e o que cresce é o acúmulo de *resultados* (10.000 chaves
  encontradas → 141 MB), não a varredura. A pasta é percorrida em streaming, sem carregar a árvore
  em memória.
- **O tempo é linear no número de arquivos**, ~2.000 arquivos/s de forma sustentada. Extrapolando na
  mesma vazão, 1 milhão de XMLs levaria por volta de 8 minutos numa varredura completa
  *(extrapolação, não medição)*.
- **A pesquisa repetida via índice custa o mesmo com 10.000 ou 100.000 arquivos** (~0,51 s e
  ~0,55 s): ela não varre o disco, então independe do tamanho do acervo.

Outras medições:

| Cenário | Resultado |
|---|---|
| ZIP de produção com 4.580 XMLs, buscando 3 chaves | ~1,5 s |
| RAR com 400 XMLs, todas localizadas por conteúdo | ~0,2 s |
| XML de lote de 25 MB, chave no final do arquivo | localizada em ~0,2 s (varredura em streaming) |
| Renderizar 1.000 resultados na tabela | ~0,2 s |
| Renderizar 10.000 resultados na tabela | ~2,1 s (uma vez); trocar de filtro depois: ~5 ms |

> ⚠️ **Sobre a variância**: medir I/O em desktop Windows é ruidoso — cache do sistema de arquivos e
> antivírus fazem a mesma configuração alternar entre modo rápido e lento por vários segundos
> seguidos (observamos até 7x de diferença sem nenhuma mudança de código). Por isso o benchmark
> repete cada cenário e mostra mínimo, mediana e máximo, em vez de um número só. Os tempos acima são
> os mínimos; as medianas ficaram ~10-20% acima.

### Pasta de rede real (produção)

Medido contra uma pasta de rede de produção com 414.912 arquivos (414.412 XMLs, ~34,3 GB) — não um
acervo sintético. Só leitura, via `scripts/bench-real-folder.js`.

| Cenário | Resultado |
|---|---|
| Lote de 10 chaves reais concentradas (uso típico — buscar um lote específico) | ~11,1 s |
| As mesmas 10 chaves, buscadas de novo (via índice) | ~121 ms (≈92x mais rápido, 0 arquivos revarridos) |
| Varredura completa forçada (chave inexistente) | não concluiu em 1h28min de espera — impraticável nesta pasta |

O contraste importa: **o uso do dia a dia (buscar um lote) é rápido e o índice entrega ganho real**;
uma varredura completa de 415 mil arquivos por uma unidade de rede mapeada, por outro lado, é
dominada por latência de rede por arquivo, não pelo programa — o mesmo volume em disco local (teste
sintético acima) leva ~50s, não mais de 1 hora. Isso não é uma limitação do XML Finder especificamente:
é o custo inerente de acessar centenas de milhares de arquivos individuais por SMB.

A tabela de resultados não usa virtualização: a 10.000 linhas ela leva cerca de 2 s para montar e
permanece fluida depois disso, o que foi considerado aceitável frente à complexidade que a
virtualização acrescentaria.

## Desenvolvimento

Pré-requisitos: [Node.js](https://nodejs.org/) 20+ e npm.

```bash
git clone https://github.com/cristiammanome-1994/xml-finder.git
cd xml-finder
npm install
npm run dev
```

### Scripts disponíveis

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o app em modo desenvolvimento (hot-reload) |
| `npm run build` | Build de produção (main + preload + renderer) em `out/` |
| `npm run typecheck` | Checagem de tipos (main e renderer) |
| `npm test` | Roda a suíte de testes (`node --test`) da lógica pura do motor de busca |
| `node scripts/bench.js gerar <qtd> <pasta>` | Gera um acervo sintético para teste de carga |
| `node scripts/bench.js medir <pasta>` | Mede a busca sobre esse acervo (min/mediana/máx de N repetições) |
| `node scripts/bench-real-folder.js "<pasta>"` | Mede a busca contra uma pasta real (rede/produção) — só leitura, nunca escreve na pasta alvo |
| `npm run dist` | Build de produção + empacota instalador (`.exe` NSIS) e versão portable em `release/` |

## Limitações conhecidas

- **RAR multivolume** (`.part2.rar`, `.r00`, ...) não é suportado pela biblioteca de leitura de RAR — a ferramenta avisa quando detecta esse padrão de nome.
- Arquivos RAR são lidos inteiros em memória para listagem/extração (limitação da biblioteca WASM usada); ZIP usa streaming real, sem essa limitação.
- Arquivos protegidos por senha são reportados como erro e pulados — não há suporte a inserir senha durante a busca.
- O instalador não é assinado digitalmente (custo de certificado de assinatura de código), então o Windows SmartScreen pode alertar na primeira execução.

## Licença

Ver [LICENSE](LICENSE) — todos os direitos reservados. O código é público para transparência e distribuição do executável, não para reuso livre.
