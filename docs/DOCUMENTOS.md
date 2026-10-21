# DOCUMENTOS E TEXTO EXTRAÍDO (fase 3E)

Um investigador entrega endereços; a aplicação guarda **o que conseguiu ler** e **o que não
conseguiu ler**, com a data, o estado HTTP e o hash do ficheiro. Nenhuma extração se transforma em
prova sozinha.

## 1. O que o extrator faz

`server/pdftext.mjs` lê o PDF sem dependências externas:

1. percorre os objetos do ficheiro (`N 0 obj … endobj`) e guarda o dicionário e o fluxo de cada um;
2. descomprime os fluxos `FlateDecode` (com teto de saída — um fluxo pode ser uma bomba de
   descompressão);
3. resolve o mapa `/ToUnicode` de cada fonte por página (`/Resources → /Font → /ToUnicode`),
   incluindo `beginbfchar`, `beginbfrange` e `beginbfrange` com lista;
4. percorre o fluxo de conteúdo trocando de fonte em cada `/Fx Tf`, trata fontes de 1 e de 2 bytes
   (`Identity-H`) e entra nos `XObject` do tipo `Form` (`/X Do`), que é onde muitos geradores
   escondem texto;
5. ordena as páginas pelo `/Kids` do nó `/Pages` quando existe;
6. devolve texto com mudanças de linha (por `Td`/`TD`/`Tm`/`T*`) e com as ligaduras tipográficas
   resolvidas (`ﬁ` → `fi`, `ﬂ` → `fl`), para que o texto seja pesquisável.

A régua não é a aparência: nos dois PDFs de referência — um do motor do Chromium (fontes
subconjuntas, `Identity-H`, `/ToUnicode`) e um escrito pelo gerador da própria aplicação (sem
`/ToUnicode`) — o texto extraído é **idêntico, palavra a palavra, ao do `pdftotext`** (poppler).
Isso é verificado em `tests/pdftext.mjs` a cada execução; se a biblioteca padrão não estiver
instalada, o teste diz que a comparação não foi feita, em vez de fingir que passou.

## 2. O que o extrator NÃO faz — dito em cada resultado

| situação | comportamento | o que a resposta diz |
| --- | --- | --- |
| PDF cifrado (`/Encrypt`) | pára | «PDF protegido por cifra: não se extrai texto (não se contorna protecção)» |
| PDF digitalizado (só imagens) | tenta OCR; se o motor não tiver dados de língua, não inventa | «OCR indisponível: …» ou o texto com `method:'ocr'`, confiança e aviso de revisão |
| PDF com *object streams* | extrai, com aviso | «a ordem do texto pode não ser a ordem visual das páginas» |
| fonte sem `/ToUnicode` | extrai o que consegue | «sem ToUnicode utilizável: acentos e nomes podem sair errados — confirmar no documento» |
| fluxo corrompido ou acima do limite | ignora esse fluxo | «n fluxo(s) não puderam ser descomprimidos … parte do texto pode faltar» |
| texto maior do que o limite | corta | «texto cortado no limite de 200 000 caracteres» |

### OCR de digitalizações (desde a fase 3F)

`server/ocr.mjs` usa `tesseract.js` 7 (WebAssembly) num worker. Decisões que importam:

- **Rede zero em runtime**: os dados de língua (`por`, `eng`) estão em disco, descarregados no build
  por `tools/fetch-ocr-data.mjs` com o `sha512` conferido contra o registo npm e `sha256` registado
  num manifesto. Sem dados locais, o OCR está **indisponível** e diz porquê (`/api/meta` →
  `documents.ocr.available=false, reason`).
- **Sem confiança, sem valor**: a confiança é medida por página; abaixo de **55/100** a página é
  assinalada e o resultado inteiro declara-se «pista, não transcrição». O texto entra na recolha com
  `method: 'ocr'` e `needsHumanReview: true` — **continua a não nascer nenhuma prova**.
- **Limites**: 6 imagens por documento, 45 s por imagem, 120 s por pedido, uma imagem de cada vez
  (fila com tecto que **recusa com motivo** em vez de crescer). Só PNG/JPEG (assinatura verificada
  antes de chegar ao motor).
- **O que não é suportado é dito**: imagens `CCITT`, `JBIG2`, `JPX/J2K` e imagens com *predictor*
  ficam declaradas não suportadas — não se inventa o que lá está.
- **`errorHandler` obrigatório**: sem ele, uma imagem inválida derrubava o processo Node (encontrado
  por um teste, corrigido, coberto).

Ver `docs/DEPENDENCIAS.md` §2 para o motivo de cada alternativa rejeitada (`pdfjs-dist`, `unpdf`,
`mupdf`, `@napi-rs/canvas`, `node-tesseract-ocr`).

## 3. Recolha: limites e guardas

`fetchDocument()` (em `server/api.mjs`) é a única porta de entrada de conteúdo externo:

- só `http`/`https`; `file://`, `ftp://` e afins são recusados;
- endereços privados, loopback, link-local e redes internas são recusados **antes** de qualquer
  pedido (SSRF), e a verificação repete-se em **cada salto** de redirecionamento;
- no máximo 5 redirecionamentos, seguidos à mão, com o destino revalidado;
- 20 s de tempo máximo; 2 MB para HTML, 12 MB para PDF; o `content-length` declarado é verificado
  antes de descarregar;
- `user-agent` identificado; nunca se enviam credenciais nem cookies do utilizador;
- devolve sempre o `sha256` do conteúdo lido, para se poder provar *o que* foi lido e *quando*.

Existe **uma** exceção, fechada por omissão: `VN_ALLOW_LOCAL_FETCH=1` permite ler o próprio servidor
local, para os testes de interface poderem servir um PDF verdadeiro. Desliga-se sozinha quando
`NODE_ENV=production` ou quando existe a variável `RENDER` (o Render define-a), e o estado aparece
em `/api/meta → documents.localFetch`. Está testada nos dois sentidos.

## 4. O documento como objeto, não como prova

Rotas (todas com sessão, CSRF nas escritas e fronteira por conta):

| rota | o que faz |
| --- | --- |
| `POST /api/projects/{id}/documents` | recolhe um URL, extrai texto, guarda o documento com hash, método e avisos; **não cria provas** |
| `GET /api/projects/{id}/documents` | lista com pré-visualização de 300 caracteres |
| `GET /api/documents/{id}` | texto completo, a pedido |
| `PATCH /api/documents/{id}` | título, nota, `reviewed` (com `reviewedAt`) |
| `DELETE /api/documents/{id}` | remove o documento; as provas que já o citavam não são tocadas |

O detalhe do projeto (`GET /api/projects/{id}`) **não** leva o texto inteiro: leva `preview` e
`textChars`. Sem isso, abrir um projeto com vinte PDFs arrastava centenas de milhares de caracteres
a cada pintura da interface.

Uma fonte inacessível **fica registada como inacessível** — com o estado HTTP, o erro e a data.
Apagar o rasto de uma fonte que não respondeu é reescrever a investigação.

## 5. Revisão humana: o único caminho para a prova

1. o documento é recolhido e o texto é mostrado num campo de leitura;
2. a pessoa seleciona o trecho exato;
3. «Usar excerto na nova prova» **preenche** o formulário de prova (título, URL canónica, excerto,
   método de extração) e não registra nada;
4. a prova só existe quando alguém carrega em «Registar prova» — e o servidor continua a validar o
   excerto, o URL e a deduplicação por origem.

O teste `tests/documents-ui.mjs` verifica exatamente esta sequência e confirma que o cabeçalho
continua a dizer «Registo de provas (0)» depois de usar o excerto.

## 6. Limite de ritmo e auditoria

- 40 recolhas por hora por utilizador; a 41.ª devolve 429 com a razão escrita (uma recolha faz
  pedidos de rede a endereços escolhidos pelo utilizador).
- Auditoria: `document_fetched` (com tipo, estado, hash e método), `document_reviewed`,
  `document_deleted`; quando um administrador abre um documento de outra conta, fica registado
  `admin_document_access` com o dono e o motivo.
- Uma conta nunca vê documentos de outra: o servidor responde **404**, não 403, para não revelar
  sequer a existência.

## 7. Testes desta fase

| suite | asserções | o que prova |
| --- | --- | --- |
| `tests/pdftext.mjs` | 19 | extração igual ao `pdftotext`; recusa de cifra, digitalizado, tamanho, bomba de descompressão; ligaduras |
| `tests/fase3e.mjs` | 21 | rotas de documentos, ausência de provas automáticas, pré-visualização, 404 entre contas, 429, auditoria, SSRF, exceção local fechada em produção, passo 8 do motor |
| `tests/documents-ui.mjs` | 6 | percurso na interface: recolher → ler → usar excerto → registar revisão, com 0 provas até decisão humana |
| `tests/ocr.mjs` | 15 | OCR real sobre digitalização (via HTTP local): `method:'ocr'`, 143 caracteres, **93/100** de confiança, revisão obrigatória; recusa de bytes que não são imagem; indisponibilidade declarada |

Execução: `node tests/pdftext.mjs`, `node tests/fase3e.mjs`, `node tests/ocr.mjs`,
`node tests/documents-ui.mjs` (este último precisa de Playwright e do Chromium já instalados;
`tools/setup-ui-env.sh` prepara as bibliotecas de sistema sem root).
