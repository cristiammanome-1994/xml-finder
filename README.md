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
- **Detecta XML, ZIP e RAR por assinatura de conteúdo**, não só pela extensão (pega arquivos renomeados ou sem extensão).
- **Não extrai arquivos compactados inteiros**: lê apenas as entradas necessárias via streaming (ZIP) ou extração seletiva (RAR).
- **Sai da busca assim que todas as chaves são encontradas**, sem varrer o resto da pasta — importante em bases com arquivos muito grandes.
- **Progresso em tempo real** (arquivos analisados, XMLs analisados, ZIPs, RARs, encontrados, tempo decorrido) com botão de cancelar.
- **Resultados filtráveis** (Todos / Encontrados / Não encontrados / Erros) com resumo (dentro de ZIP, dentro de RAR, em pastas soltas).
- Para cada XML encontrado: **copiar caminho**, **copiar caminho completo** (incluindo caminho interno no ZIP/RAR), **abrir a pasta no Explorer**, **extrair só aquele XML** (sem descompactar o resto) e **visualizar o XML formatado**.
- **Exportação para Excel e CSV** dos resultados, e exportação separada só dos **não encontrados**.
- **Histórico de pesquisas** local, com opção de reabrir uma pesquisa anterior.
- **Tema claro/escuro**, alternável e persistido entre sessões.
- Continua a busca mesmo diante de **ZIP/RAR corrompido, XML malformado, arquivo protegido por senha ou sem permissão de leitura** — registra como erro e segue em frente.

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
│       ├── xmlMatcher.ts     # Extração de chave/Id/CNPJ do conteúdo XML via regex leve
│       ├── extractor.ts      # Extração de um único arquivo de dentro de ZIP/RAR aninhados
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
| Exportação | [exceljs](https://github.com/exceljs/exceljs) (Excel), gerador CSV próprio |
| Ícones | [lucide-react](https://lucide.dev/) |
| Fonte | [Geist](https://vercel.com/font) (empacotada localmente, sem depender de rede) |
| Empacotamento | [electron-builder](https://www.electron.build/) (NSIS + portable) |

### Motor de busca, em resumo

1. Percorre a pasta raiz uma única vez (não faz uma varredura completa por identificador).
2. Para cada arquivo: classifica por extensão e, se necessário, por assinatura de bytes (`PK\x03\x04` para ZIP, `Rar!` para RAR, `<?xml`/`<` para XML — mesmo sem a extensão correta).
3. XML solto ou dentro de ZIP/RAR: primeiro tenta casar pelo **nome** (chave de 44 dígitos extraída do nome, ou trecho de nome); se não achar, lê um trecho do **conteúdo** (com fallback para o arquivo inteiro se necessário) e procura a chave de acesso.
4. ZIP/RAR encontrados dentro de outro ZIP/RAR são abertos recursivamente até a profundidade configurada, sempre a partir de um buffer em memória — nunca extraindo o arquivo compactado inteiro para disco.
5. Assim que todas as chaves pedidas são encontradas, a busca para imediatamente (não continua varrendo o resto da base).

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
| `npm run dist` | Build de produção + empacota instalador (`.exe` NSIS) e versão portable em `release/` |

## Limitações conhecidas

- **RAR multivolume** (`.part2.rar`, `.r00`, ...) não é suportado pela biblioteca de leitura de RAR — a ferramenta avisa quando detecta esse padrão de nome.
- Arquivos RAR são lidos inteiros em memória para listagem/extração (limitação da biblioteca WASM usada); ZIP usa streaming real, sem essa limitação.
- Arquivos protegidos por senha são reportados como erro e pulados — não há suporte a inserir senha durante a busca.
- O instalador não é assinado digitalmente (custo de certificado de assinatura de código), então o Windows SmartScreen pode alertar na primeira execução.

## Licença

Ver [LICENSE](LICENSE) — todos os direitos reservados. O código é público para transparência e distribuição do executável, não para reuso livre.
