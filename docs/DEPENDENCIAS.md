# AUDITORIA DE FERRAMENTAS E REPOSITÓRIOS (fase 3F)

Pergunta a que este documento responde: **que ferramentas e projetos de código aberto valem a pena
nesta aplicação, e porquê — ou porque não.**

Regra de honestidade: os números abaixo foram recolhidos em 2026-10-21 com dois comandos
reproduzíveis (`npm run audit:deps`, `node tools/audit-deps.mjs --candidates=…`) que consultam o
registo npm e a base pública de vulnerabilidades OSV. O que é opinião está marcado como opinião.

## 0. Como se reproduz

```bash
node tools/audit-deps.mjs                     # o que está instalado (versões, licenças, vulns)
node tools/audit-deps.mjs --candidates=lista  # avalia candidatos sem instalar nada
cat docs/DEPENDENCIAS-DADOS.json              # dados crus da última execução
```

O audímetro **falha** (código 1) perante vulnerabilidade alta/crítica ou licença proibida, e
**avisa** (código 2) quando não conseguiu falar com o OSV — porque «não consegui verificar» não é
«está tudo bem».

## 1. O que a aplicação já tinha

| dependência | versão | licença | papel | decisão |
| --- | --- | --- | --- | --- |
| `cytoscape` + `cytoscape-fcose` | 3.34.x / 2.2.0 | MIT | desenho do grafo (cópia local em `vendor/`, não CDN) | **manter**: é o coração visual; servido do próprio domínio |
| `playwright` | 1.48.2 → **1.64.1** | Apache-2.0 | testes de interface | **atualizado**: a 1.48.2 tem a vulnerabilidade alta `GHSA-7mvr-c777-76hp` (descarrega browsers sem verificar o certificado TLS); corrigida em 1.55.1 |
| `d3-force`, `graphology` | dev | MIT | alternativas de desenho avaliadas noutra fase | **manter como dev**, não entram no pacote |

Achado real da auditoria: **a única vulnerabilidade alta na árvore estava numa dependência de
desenvolvimento** (`playwright`), não em produção. Foi corrigida e a vulnerabilidade desapareceu da
verificação seguinte.

## 2. Candidatos avaliados — e a decisão, com motivo

Estado do registo npm em 2026-10-21 (versão mais recente instalável, licença, tamanho descomprimido,
descarregamentos semanais, vulnerabilidades conhecidas no OSV).

| pacote | versão | licença | KB | sem./desc. | decisão | motivo |
| --- | --- | --- | --- | --- | --- | --- |
| **`tesseract.js`** | 7.0.0 | Apache-2.0 | 1 378 | 2,26 M | **ADOPTADO** | OCR em WebAssembly: sem binário nativo, sem `exec`, um worker isolado. Resolve a lacuna P2 (digitalizações) |
| `tesseract.js-core` | 6.1.2 | Apache-2.0 | 29 889 | 2,24 M | transitiva | é o WASM do motor; entra com o `tesseract.js` |
| `@tesseract.js-data/{por,eng}` | 1.0.0 | Apache-2.0 (tessdata) | 1,4 / 2,9 MB (gz) | — | **ADOPTADO no build** | dados de língua descarregados **no build** com `dist.integrity` conferido, não a meio de um pedido |
| `pdfjs-dist` | 6.4.299 | Apache-2.0 | 34 095 | 20,4 M | **REJEITADO (por agora)** | as versões 5/6 exigem **Node ≥ 22** (`Promise.withResolvers`) e o serviço corre em Node 20; a 4.10.38 funciona, mas não traz nada que o nosso extrator não faça (ver §3) |
| `unpdf` | 1.9.1 | MIT | 2 123 | 4,1 M | rejeitado | também exige Node ≥ 22; e a sua extração não é melhor que a nossa (compara §3) |
| `mupdf` | 1.28.1 | **AGPL-3.0** | 13 988 | 330 k | **PROIBIDO** | AGPL contamina o serviço em rede; incompatível com o licenciamento atual |
| `@napi-rs/canvas` | 1.0.13 | MIT | 157 (+binários) | — | **REJEITADO** | testado: **segmentation fault** neste ambiente ao rasterizar; um binário nativo que pode matar o processo não entra num serviço de 512 MB |
| `otplib` | 13.5.0 | MIT | 597 | 2,2 M | rejeitado | TOTP são ~60 linhas de `crypto` (HMAC-SHA1 + Base32); implementámos e validámos com os vectores do RFC 6238 |
| `node-tesseract-ocr` | 2.2.1 | MIT | 9 | 21 k | **PROIBIDO** | último lançamento em **2021** e vulnerabilidade `GHSA-8j44-735h-w4w2`; chama o binário por shell |
| `speakeasy` | 2.0.0 | MIT | — | 484 k | rejeitado | sem lançamentos desde **2016** |
| `bullmq` | 6.4.0 | MIT | 3 361 | 5,8 M | adiado | fila de execuções exigiria Redis (mais um serviço); a fila atual é em processo e está declarada como limitação |
| `ioredis` | 6.0.0 | MIT | — | — | adiado | só faz sentido com Redis |
| `better-sqlite3` | 13.0.3 | MIT | 26 663 | 7,2 M | adiado | nativo (compilação no build) + disco persistente pago; o P0 atual é disco, não motor |
| `pg` / `postgres` | 8.23.1 / 3.4.9 | MIT / Unlicense | 100 / 293 | 40 M / 14 M | **recomendado, fase seguinte** | é a solução real para o P0 (disco efémero); a API do `store.mjs` já foi desenhada para ser substituível |
| `nodemailer` | 10.2.0 | MIT-0 | 1 707 | 15,6 M | preparado, não ligado | reset de palavra-passe/verificação de email precisam de SMTP; sem credenciais, a aplicação diz «email não configurado» em vez de fingir |
| `resend` | 6.34.1 | MIT | 380 | 8,1 M | alternativa | API em vez de SMTP; escolher quando houver chave |
| `@simplewebauthn/server` | 14.0.3 | MIT | 761 | 4,2 M | **recomendado (P2)** | passkeys/WebAuthn: mais forte que TOTP e sem segredo partilhado; fica para depois do TOTP porque exige cerimónias no browser |
| `helmet` | 8.3.0 | MIT | 103 | 9,6 M | rejeitado | os cabeçalhos já são escritos à mão em `tools/serve.mjs` (CSP, nosniff, referrer) e auditados; uma dependência a mais aqui não paga |
| `rate-limiter-flexible` | 11.2.3 | ISC | 225 | 1,8 M | rejeitado | os limitadores locais são ~20 linhas e não precisam de estado externo; com várias instâncias o problema é o Redis, não a biblioteca |
| `jose` | 6.2.13 | MIT | 213 | 93 M | não necessário | as sessões usam cookie opaco com hash no servidor; JWT traria revogação mais difícil |
| `argon2` | 0.45.1 | MIT | 936 | 1,5 M | rejeitado | compilação nativa e `postinstall`; scrypt do `node:crypto` (N=2^15) é adequado e já está testado |
| `@noble/hashes`, `sanitize-html`, `file-type` | — | MIT | — | — | não necessários | hashes e sanitização estão cobertos pelo `node:crypto` e pelo tratamento de texto que já existe |

## 3. Verificação cruzada: o nosso extrator contra a biblioteca mais usada

Teste feito com `pdfjs-dist@4.10.38` (a que corre em Node 20) sobre o mesmo PDF real de 2 páginas
gerado pelo Chromium:

| motor | texto obtido | observação |
| --- | --- | --- |
| `server/pdftext.mjs` (nosso) | `Relatório de teste — documento real gerado pelo Chromium` … | **idêntico ao `pdftotext`**, palavra a palavra |
| `pdfjs-dist` | `Relatório de teste — documento real gerado pelo Chromium  Este   fi cheiro é um PDF…` | insere espaços dentro de palavras ao lidar com ligaduras (`.notdef`/`ﬁ`), corta a linha de outra forma |

Conclusão honesta: o `pdfjs-dist` é maduro e cobre casos que nós não cobrimos (JPX, cifra com
password, rasterização), mas **para o que esta aplicação faz — extrair texto citável — não é melhor**
e custa +34 MB e Node 22. Fica registado como a primeira escolha **se** um dia for preciso
rasterizar páginas (aí com `@napi-rs/canvas`, depois de o problema do segfault estar resolvido e
testado no ambiente de produção).

## 4. O que foi implementado nesta fase

### 4.1 OCR de digitalizações (`server/ocr.mjs`, `tools/fetch-ocr-data.mjs`)

- `tesseract.js` 7 num worker, um pedido de cada vez, fila com tecto (**recusa com motivo** em vez de
  fila infinita), 45 s por imagem, 6 imagens por documento, 120 s por pedido.
- Dados de língua **locais**, descarregados no build com `sha512` conferido contra o registo npm; sem
  dados e sem `OCR_ALLOW_CDN=1`, o OCR está **indisponível** e diz porquê (testado nos dois estados).
- **`errorHandler` obrigatório**: sem ele, o tesseract lança dentro do worker e **derruba o
  processo**. Descoberto por um teste que lhe entregou um PDF disfarçado de imagem — o servidor
  morreu. Corrigido e coberto por teste (assinatura PNG/JPEG obrigatória antes de chegar ao motor).
- Confiança medida por página; abaixo de 55/100 a página é assinalada e o resultado diz que é
  «pista, não transcrição».
- PDF digitalizado: extraem-se as imagens (`DCTDecode` e `FlateDecode` RGB/cinza → PNG construído em
  memória, sem dependências); CCITT/JBIG2/JPX e imagens com predictor são **declaradas não
  suportadas**, nunca substituídas por texto inventado.
- **Continuam a não nascer provas**: o texto entra com `method: 'ocr'` e revisão humana obrigatória.

### 4.2 Segundo factor TOTP (`server/mfa.mjs`) — sem dependências

- RFC 6238 validado com os **quatro vectores de teste** oficiais (`287082`, `081804`, `005924`,
  `279037`).
- À prova de repetição: o mesmo código não entra duas vezes (guarda-se o último passo aceite);
  desafio de login de uso único e com validade de 5 min; a **sessão não existe antes do código**.
- 10 códigos de recuperação, de uso único, guardados só como HMAC-SHA256 com chave derivada do
  `APP_SECRET` (finalidade própria); nunca voltam a ser servidos pela API.
- Limite de 8 códigos errados por conta/10 min; cada falha auditada com tentativas restantes.
- Trocar a palavra-passe e desactivar o segundo factor exigem palavra-passe **e** código: um cookie
  roubado não muda credenciais nem expulsa o dono.
- Interface: activação com segredo mostrado uma vez, códigos de recuperação descarregáveis,
  ecrã de segundo passo no login, recusa com contagem de tentativas.

### 4.3 Durabilidade da base (`server/store.mjs`)

| risco real | antes | agora |
| --- | --- | --- |
| escrita interrompida (JSON truncado) | ficheiro ilegível → base recomeçada **em silêncio** | `tmp → fsync → rename → fsync` da pasta; `sha256` ao lado; recuperação da **última cópia válida**, com o nome dela na resposta de `/ready` |
| perda total sem aviso | dados desapareciam | se não houver cópia válida, a base recomeça vazia e **declara-o** (`recovery.freshStart`), preservando o ficheiro danificado como `db.json.broken-*` |
| duas instâncias a escrever a mesma pasta (deploy do Render sobrepõe-se) | corrupção silenciosa | `db.lock` com pid vivo → a segunda instância entra em **só-de-leitura**, `/ready` devolve **503** e as escritas recebem 503 `retryable` |
| gravação falhada a meio de uma mutação | memória ficava à frente do disco | desfaz-se a alteração em memória a partir da última gravação boa |

Isto **mitiga** o P0 (disco efémero); não o resolve. A solução continua a ser disco persistente ou
Postgres — e o `store.mjs` foi mantido com uma superfície pequena precisamente para ser trocado.

## 5. Recomendações por prioridade

**Críticas (fazer a seguir)**

1. **Postgres (ou disco persistente)** — o P0 só acaba aqui. `pg` está avaliado: MIT, 100 KB, sem
   vulnerabilidades, mantido. A migração deve manter a mesma API de `store` e correr **ao lado** do
   ficheiro até haver testes de paridade.
2. **SMTP para reset de palavra-passe e verificação de email** (`nodemailer` ou `resend`). Sem isso,
   quem perde a palavra-passe depende de um administrador — hoje a interface diz isso mesmo, mas é
   uma lacuna P1 real.

**Importantes**

3. **WebAuthn/passkeys** (`@simplewebauthn/server`) como segundo factor preferido: elimina segredos
   partilhados e ataques de phishing em tempo real.
4. **Fila persistente** (`bullmq` + Redis) para execuções longas; hoje o trabalho perde-se se o
   processo reiniciar (o registo do que aconteceu fica, o trabalho não).
5. **Rasterização de PDF** para digitalizações com CCITT/JBIG2 (`pdfjs-dist` + canvas), **quando**
   houver Node 22 e o binário nativo estiver validado em produção.

**Vigiar**

6. `tesseract.js` traz o motor em WASM (~30 MB instalados) e usa CPU: o limite de concorrência é
   parte da segurança, não uma otimização.
7. Atualizar dependências a cada fase com `npm run audit:deps`; a política é explícita: sem
   vulnerabilidades altas/críticas, sem AGPL/GPL/SSPL/BUSL no serviço.

## 6. Ferramentas do próprio repositório (o que se usa para auditar)

| ferramenta | para que serve | estado |
| --- | --- | --- |
| `tools/audit-deps.mjs` | vulnerabilidades (OSV) + licenças + candidatos, com códigos de saída | **novo** |
| `tools/fetch-ocr-data.mjs` | dados de OCR com integridade npm conferida, no build | **novo** |
| `tools/setup-ui-env.sh` + `tools/ui-env.sh` | bibliotecas de sistema para o Chromium **sem root** (extrai `.deb` para `~/.local/lib`) | **novo** |
| `tools/status.mjs` | coerência entre código e documentação (versão, esquema, rotas, testes) | existente |
| `tools/audit-catalog.mjs` | catálogo de APIs públicas (usado na fase das APIs) | existente |
| `pdftotext`/`pdfinfo` (poppler) | régua externa para validar a extração de PDF | usado nos testes, não é dependência de produção |

Nota de ambiente: o Chromium novo exige bibliotecas (`libnspr4`, `libnss3`, `libatk`, …) que este
contentor não tem e não pode instalar como root. `tools/setup-ui-env.sh` resolve isso sem root e é
idempotente — sem ele, os testes de interface não correm (e o teste **diz** isso, não finge passar).
