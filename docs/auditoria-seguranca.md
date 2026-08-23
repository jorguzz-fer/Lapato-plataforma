# Auditoria de segurança — 23/08/2026

Revisão do sistema inteiro contra o **Blueprint §6** (Segurança e autenticação) e o
modelo de ameaças que ele define. Cada item abaixo foi verificado no código, não inferido
da documentação.

**Resumo:** sete lacunas encontradas, todas corrigidas nesta rodada. Nenhuma delas era
falha de autenticação ou de isolamento entre instituições — essas partes estavam certas e
com teste automatizado. O que faltava eram as **proteções de fluxo** (rate limiting), os
**limites de recurso** (upload) e os **cabeçalhos do navegador** na SPA.

---

## 1. Corrigido nesta rodada

### 1.1 🔴 Não havia rate limiting em lugar nenhum

O Blueprint §6 exige, na tabela de ameaças: "Força bruta / stuffing → Rate limit, lockout,
MFA". Existiam o lockout e o MFA; o rate limit não existia.

Os dois não são substitutos. O lockout defende **uma conta** de muitas tentativas — 5
falhas e a conta fecha. O *credential stuffing* faz o oposto: tenta **uma senha em milhares
de contas**, e nenhuma delas chega perto de 5 falhas. Contra isso só o teto por IP funciona.

**Correção.** `@nestjs/throttler` como guard global, rodando **antes** do guard de sessão —
uma enxurrada anônima é cortada antes de virar consulta ao banco.

| Onde | Padrão | Variável |
|---|---|---|
| Todas as rotas | 300 por minuto, por IP e por rota | `RATE_LIMIT_REQUISICOES` |
| Login, MFA e validação pública de laudo | 10 por minuto, por IP | `RATE_LIMIT_LOGIN` |

A contagem é por rota, de propósito: estourar o login não pode derrubar o resto da API para
o mesmo IP. Prova: `apps/api/src/rate-limit.test.ts` dispara logins com um e-mail diferente
a cada tentativa — nenhuma conta é bloqueada e a rajada é cortada mesmo assim.

### 1.2 🔴 Upload sem limite antes do buffer

`FileFieldsInterceptor` estava sem `limits`. O multer guarda o arquivo **inteiro em
memória** antes de o handler existir; a checagem de 25 MB estava no serviço, ou seja,
depois. Um usuário autenticado enviando alguns GB derrubaria o processo por falta de
memória sem nunca chegar à validação.

**Correção.** `limits: { fileSize: 25 MB, files: 2, fields: 20 }` no interceptor — o multer
aborta durante o stream. A checagem do serviço continua: ela é a regra de negócio, o limite
do interceptor é a defesa do processo.

### 1.3 🟠 O IP real do usuário não chegava à aplicação

`trust proxy` nunca foi configurado. Em produção o request chega pelo Traefik do Coolify,
então `req.ip` era **o IP do proxy, igual para todo mundo**. Duas consequências:

- o rate limit recém-criado seria um balde único — a rajada de um usuário derrubaria todos;
- o `audit_log` vinha gravando o IP do proxy no lugar do IP de quem agiu. A trilha existe
  desde o primeiro commit, mas a coluna `ip` não valia nada.

**Correção.** `TRUST_PROXY` (quantidade de saltos confiáveis; `1` atrás do Coolify).
Padrão `0` porque confiar em `X-Forwarded-For` sem proxy na frente é pior que não ter IP —
o cliente escolheria o próprio. Com `NODE_ENV=production` e `TRUST_PROXY=0` a API avisa na
subida.

> **Ação pendente no ambiente:** `TRUST_PROXY=1` precisa ser definido no `lapato-api`
> (Coolify → Environment Variables). O código sozinho não resolve.

### 1.4 🟠 A SPA era servida sem nenhum cabeçalho de segurança

O `helmet` protege a **API**. Quem carrega e executa JavaScript é o front, servido por
nginx — e o `nginx.conf` tinha apenas `Cache-Control`. Sem CSP, um XSS na SPA teria a
página inteira; sem `X-Frame-Options`, qualquer site poderia embutir o LAPATO num iframe.

**Correção.** `infra/nginx-seguranca.conf`, incluído no `server` e em cada `location` (no
nginx, um `location` com `add_header` próprio deixa de herdar os de cima — os dois blocos
do site definiam `Cache-Control`, então herdariam nada):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none';
  base-uri 'self'; form-action 'self'; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

`style-src` precisa de `'unsafe-inline'`: o Emotion, que o Material UI usa, injeta as regras
em `<style>` em tempo de execução. `script-src` não tem essa concessão.

**Verificação:** o build de produção foi servido com exatamente esses cabeçalhos e
navegado com Chromium em sete telas, coletando violações do console. Resultado final: **0
violações de CSP, 0 erros de console**.

### 1.5 🟠 Google Fonts carregado em tempo de execução

A primeira rodada da verificação acima acusou 8 violações, todas do mesmo `@import` de
`fonts.googleapis.com` em `estilos.css`. Isso não era só um estorvo para a CSP: a folha é
buscada **pelo navegador de cada usuário**, entregando IP e user-agent de quem opera o
laboratório a um terceiro em toda visita — transferência que nenhuma base legal do sistema
cobre (Blueprint §14).

**Correção.** A Inter passa a vir do pacote `@fontsource-variable/inter`, empacotada junto
com a aplicação. A CSP continua sem exceção para domínio de terceiro, e some uma requisição
externa bloqueante do carregamento.

### 1.6 🟡 `Content-Disposition` com nome de arquivo sem escape

Três rotas devolvem bytes com `filename="${nomeArquivo}"`, e o nome vem do arquivo que o
usuário enviou. Uma aspa no meio fecha o valor mais cedo e o resto do nome vira novos
parâmetros do cabeçalho — dá para trocar o `filename` que o navegador salva. (CR/LF já era
recusado pelo Node, então injeção de cabeçalho inteiro não passava.)

**Correção.** `nomeParaCabecalho()` neutraliza aspa, barra invertida e caracteres de
controle, com teste unitário.

### 1.7 🟡 Erros 429 e 413 respondiam em inglês do framework

"ThrottlerException: Too many requests" e "File too large" chegariam assim na tela.
Corrigido para português, no formato RFC 7807 que o resto da API usa.

### 1.8 Dependências

`pnpm audit` saiu de 5 achados moderados para 3, com overrides de `qs` (≥6.15.2) e
`esbuild` (≥0.25.0). Build, `drizzle-kit generate` e os 130 testes verdes depois da troca.

---

## 2. Verificado e correto — nada mudou

Levantado item a item no código, não presumido:

| Exigência do Blueprint §6 | Estado |
|---|---|
| Auth e authz 100% server-side | Guards globais negam por padrão; toda rota exige permissão explícita |
| Argon2id | `@node-rs/argon2`, com hash falso no caminho de usuário inexistente para igualar o tempo de resposta |
| Lockout progressivo | 5 falhas; o segundo fator entra no mesmo contador da senha |
| MFA TOTP obrigatório para papéis sensíveis | Quem assina laudo não passa do funil sem cadastrar |
| Reset sem enumeração | Instituição inexistente, usuário inexistente e senha errada devolvem a mesma resposta |
| Cookie httpOnly + Secure + SameSite | `httpOnly`, `sameSite: lax`, `Secure` obrigatório em produção (a API recusa subir sem) |
| Revogação imediata | Trocar a senha revoga todas as sessões |
| RBAC com menor privilégio | Hierarquia do M02 resolvida no servidor |
| Isolamento entre instituições | RLS com `FORCE`, usuário da aplicação `NOBYPASSRLS`, teste automatizado tenant A × tenant B |
| Auditoria imutável | `audit_log` e `evento_dominio` com trigger que barra UPDATE e DELETE |
| Acesso a arquivos | Bucket privado; os bytes saem pela API depois da checagem de permissão, nunca por URL pública |
| Superfície mínima | Único ingress público; Postgres, Redis e MinIO sem portas publicadas |
| Segredos | Nada versionado; `.env.example` com placeholders; gitleaks na CI |
| Supply chain | Lockfile fixo, `pnpm audit`, gitleaks e CodeQL bloqueando merge |
| Cabeçalhos da API | `helmet` com HSTS, `nosniff` e CSP estrita em produção |

---

## 3. Aberto — recomendações

Nenhum destes é regressão; são coisas que o Blueprint pede e que ainda não existem, com o
motivo de não estarem nesta entrega.

| # | Item | Gravidade | Por que ficou de fora |
|---|---|---|---|
| 1 | `react-router` 6.30.x: open redirect e XSS (GHSA) | 🟠 | Não há correção na linha 6.x; exige subir para a 7, que é major. **Não é explorável hoje**: nenhuma navegação da aplicação recebe destino vindo de entrada do usuário (conferido rota por rota). Vale agendar o upgrade, não empurrá-lo junto de uma correção de segurança |
| 2 | Rate limit em memória do processo | 🟡 | Com mais de uma réplica cada uma tem seu balde e o teto multiplica. Hoje roda uma réplica. O Redis já está na stack para quando isso mudar |
| 3 | Sem token anti-CSRF em mutações | 🟡 | `SameSite=Lax` bloqueia o cookie em POST cross-site, que é o vetor real. O Blueprint pede os dois; o segundo entra quando houver fluxo que precise de `SameSite=None` |
| 4 | Sem códigos de recuperação de MFA | 🟡 | Perder o aparelho hoje exige o CLI `redefinir-senha` com `RESET_MFA=limpar`. É operação de administrador, não de usuário |
| 5 | Sem alerta de novo dispositivo | 🟡 | Depende do M26 (Notificações), que ainda não tem documentação |
| 6 | Sem rotação automática de segredos | 🟡 | Depende de cofre (Vault/KMS). Hoje os segredos vivem nas variáveis do Coolify |
| 7 | Pentest antes do go-live | — | Exigência de SSDLC do Blueprint §6. Não é algo que se resolve em código |
| 8 | Login social OIDC e WebAuthn/Passkeys | — | O Blueprint lista como métodos possíveis, não obrigatórios. E-mail + senha + TOTP atende |

---

## 4. Como repetir a verificação da CSP

O que prova que a CSP não quebrou a aplicação não é ler o cabeçalho — é navegar com ele
ligado. O roteiro: construir o front (`pnpm build`), servi-lo com os cabeçalhos de
`infra/nginx-seguranca.conf`, subir a API, e percorrer as telas com Chromium coletando
mensagens de console que casem com `Refused to` ou `Content Security Policy`. Qualquer
violação é falha — inclusive as que não quebram a tela, porque indicam recurso externo
sendo buscado.

Foi assim que o Google Fonts apareceu: ele não estava no `index.html`, estava num `@import`
de CSS, e nenhuma leitura de código o teria encontrado antes de o navegador reclamar.
