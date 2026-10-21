# Verificação de acesso às fontes

Uma prova registada diz «consultámos isto em tal data». Com o tempo, a página fecha, muda de
endereço ou passa a exigir subscrição. Este módulo (`server/access.mjs`) verifica **agora** se a
fonte responde, e só isso.

## O que é feito

`POST /api/evidence/{id}/check-access` — uma prova.
`POST /api/projects/{id}/check-access` — até 10 provas por pedido (`limit`, predefinição 5),
apenas as que têm URL.

O resultado fica guardado na prova em `access`:

```json
{
  "status": "inacessivel",
  "stateLabel": "inacessível",
  "httpStatus": 403,
  "contentType": "text/html",
  "checkedAt": "2026-10-21T19:22:31.004Z",
  "finalUrl": "https://exemplo.pt/artigo",
  "reason": "acesso restrito (HTTP 403): registada como inacessível; não contornamos barreiras de acesso",
  "redirects": [],
  "method": "GET (sem cookies, sem credenciais, sem execução de scripts)",
  "limitations": ["verifica uma só página, a pedido do utilizador: não é recolha automática", "…"]
}
```

## O que **não** é feito (por decisão, não por falta de tempo)

- **Não contorna barreiras.** Sem paywall, sem muro de registo, sem CAPTCHA, sem tentar outro
  caminho quando a resposta é 401/402/403/407. Um 403 é registado como inacessível, com a razão.
- **Não guarda conteúdo.** Só metadados: estado, HTTP, tipo, bytes lidos, duração. O corpo é lido
  até um limite (64 KB por omissão; ficheiros declarados acima de 50× esse limite nem são
  transferidos) e descartado.
- **Não recolhe automaticamente.** Verifica uma página por prova, a pedido de uma pessoa.
- **Não muda estados de validação.** Se a fonte não responde, a resposta traz
  `suggestion: "fonte-inacessivel"` com `requiresHuman: true`: quem muda o estado é uma pessoa. Um
  teste verifica que `validationState` fica igual antes e depois.
- **Não verifica conteúdo.** Um 200 diz que a página responde, não que o excerto está lá. Isso
  continua a ser trabalho humano (ou do passo de extracção, com revisão).

## Guardas contra SSRF

Antes de qualquer pedido de rede:

- só `http`/`https` (`file:`, `ftp:`, `data:` recusados);
- URLs com credenciais incorporadas recusados;
- resolução DNS verificada: loopback, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (inclui
  metadados de cloud), CGNAT `100.64/10`, multicast, reservados e IPv6 equivalentes (`::1`, `fe80::`,
  `fc00::/7`, IPv4 mapeado) são recusados;
- redireccionamentos seguidos **à mão**, no máximo 3, com cada destino revalidado — um `302` para
  `http://10.0.0.7/` pára com «bloqueado por segurança»;
- `AbortController` com tempo limite (12 s por omissão, máximo 30 s);
- limite de 60 verificações por utilizador por hora (a rota não pode ser um proxy aberto);
- nenhum cabeçalho de autenticação, nenhum cookie, `user-agent` identificado.

## Testes

`tests/fase3c.mjs` cobre: endereços internos (IPv4, IPv6, IPv4 mapeado), `file://`, credenciais na
URL, SSRF por DNS, redireccionamento para rede interna, 403 → inacessível + sugestão humana, 200 →
acessível sem validar conteúdo, tempo esgotado, corte de corpo e ficheiro declarado enorme, além do
isolamento entre contas (prova alheia → 404) e da prova retirada (409).
