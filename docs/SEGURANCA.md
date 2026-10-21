# SEGURANÇA: SEGUNDO FACTOR E DURABILIDADE DA BASE (fase 3F)

Dois problemas reais desta aplicação, tratados com código testado: **uma palavra-passe apanhada
bastava para entrar** e **uma escrita interrompida podia apagar trabalho sem aviso**. O que se segue
descreve o que existe, o que não existe e como foi verificado.

## 1. Verificação em dois passos (TOTP)

`server/mfa.mjs` — implementação própria, sem dependências, validada contra o RFC 6238.

| aspeto | decisão | porquê |
| --- | --- | --- |
| algoritmo | TOTP SHA-1, 6 dígitos, passo 30 s, janela ±1 | é o que todas as aplicações de autenticação suportam; sem dependências exteriores |
| segredo | 20 bytes aleatórios, Base32, mostrado **uma única vez** na ativação | reduz a janela de exposição; a API de estado só devolve máscara (`AB••••…YZ`) |
| ativação | exige a palavra-passe atual + confirmação com um código | um cookie roubado não ativa nem troca o segundo fator |
| login | `POST /api/auth/login` devolve **desafio**, não sessão | a sessão só nasce depois do código; testado que `/api/auth/me` continua `null` |
| repetição | o mesmo código não entra duas vezes (guarda-se o último passo aceite); desafio de uso único, 5 min | impede reutilização de um código visto por cima do ombro |
| recuperação | 10 códigos de uso único, guardados só como HMAC-SHA256 com chave derivada do `APP_SECRET` | sem telemóvel não se perde a conta, e o servidor não guarda códigos utilizáveis |
| limite | 8 códigos errados por conta em 10 min → 429 com razão escrita | trava ataques de força bruta ao código |
| palavra-passe | trocar exige palavra-passe **e** código (ou código de recuperação) | impede sequestro de conta a partir de uma sessão roubada |
| desactivar | exige palavra-passe **e** código; termina as outras sessões | desligar o segundo fator é a operação mais perigosa: fica travada e auditada |
| auditoria | `mfa_setup_started`, `mfa_enabled`, `mfa_challenge`, `mfa_failed`, `mfa_recovery_regenerated`, `mfa_disabled` | cada passo do ciclo fica registado com IP |

Vectores de teste do RFC 6238 verificados a cada execução (`tests/seguranca.mjs`):
`t=59 → 287082`, `t=1111111109 → 081804`, `t=1234567890 → 005924`, `t=2000000000 → 279037`.

**Não implementado**: WebAuthn/passkeys (avaliado em `docs/DEPENDENCIAS.md` §2: `@simplewebauthn/server`
é a escolha, fica para a fase seguinte), SMS (não se usa: é o segundo fator mais fraco e o mais
caro), e «lembrar este dispositivo» (exigiria tokens de longa duração — risco maior do que o
benefício nesta fase).

## 2. Durabilidade da base de dados

`server/store.mjs` — mesmas garantias, mais rede de segurança:

1. **Escrita atómica com `fsync`**: `db.json.tmp` → `fh.sync()` → `rename` → `fsync` da pasta. Antes,
   o `rename` era atómico mas os bytes podiam não estar no disco.
2. **Integridade verificável**: `db.json.sha256` é escrito a cada gravação e verificado na leitura.
3. **Cópia da última gravação boa** (`db.json.ultima-copia.json`) + até 3 cópias datadas.
4. **Recuperação declarada**: se o ficheiro principal estiver truncado ou não corresponder ao
   `sha256`, carrega-se a cópia válida mais recente e `/ready` diz qual
   (`checks.storage.integrity.recoveredFrom`), com o motivo.
5. **Recomeço nunca silencioso**: sem cópia válida, a base começa vazia e isso é declarado
   (`recovery.freshStart`), com o ficheiro danificado preservado em `db.json.broken-*`.
6. **Bloqueio de instância**: `db.lock` com pid. Se outra instância viva escreve na mesma pasta, esta
   entra em **só-de-leitura**: `/ready` → **503**, escritas → **503 `retryable`**, leituras
   continuam a funcionar. Isto importa no Render, onde um deploy pode sobrepor duas instâncias.
7. **Desfazer em memória**: se uma gravação falhar, o estado em memória volta ao último gravado com
   sucesso (antes, a memória ficava à frente do disco e uma resposta 200 podia não ter sido gravada).

O que isto **não** resolve: o disco do plano gratuito continua efémero. Um deploy apaga tudo. A
mitigação existente (cópia de segurança descarregável e reposição) é um processo manual; a solução é
Postgres ou disco persistente.

## 3. Outras correções de segurança desta fase

- **OCR pode derrubar o processo**: o `tesseract.js` lança dentro do worker quando recebe uma imagem
  inválida, e sem `errorHandler` o erro sobe e mata o processo Node. Corrigido com `errorHandler` e
  com verificação de assinatura PNG/JPEG **antes** de entregar bytes ao motor. Coberto por teste.
- **Dados de língua de OCR sem rede em runtime**: descarregados no build com `dist.integrity`
  (sha512) conferido contra o registo npm, com `sha256` registado em `manifest.json`. Sem dados
  locais, o OCR declara-se indisponível em vez de ir buscar um modelo a um CDN de terceiros.
- **`playwright` 1.48.2 → 1.64.1**: a versão antiga tem vulnerabilidade alta
  (`GHSA-7mvr-c777-76hp`, descarrega browsers sem verificar o certificado TLS). Encontrada pelo novo
  `tools/audit-deps.mjs`; a árvore de produção não tinha vulnerabilidades altas.

## 4. Como verificar

```bash
node tests/seguranca.mjs      # 25 asserções: TOTP, fluxo HTTP, base/recuperação/bloqueio
node tests/mfa-ui.mjs         # 10 asserções na interface (Playwright)
node tools/audit-deps.mjs     # vulnerabilidades e licenças das dependências
curl -s localhost:8080/ready  # integridade, cópias, bloqueio e modo de leitura
```

O que ainda falta (declarado, não escondido): MFA obrigatório para administradores (hoje é
opcional), alertas de segurança por email, e rotação automática de sessões após mudança de
privilégios.
