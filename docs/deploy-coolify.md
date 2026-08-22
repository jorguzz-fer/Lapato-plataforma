# Deploy no Coolify — sem Docker Compose

Produção não usa Compose. Cada peça é um recurso próprio no Coolify, construído
a partir do seu Dockerfile. O Compose sobrou só para desenvolvimento local
(`infra/docker-compose.yml`).

Domínio de produção: **`app.lapato.com.br`**.

---

## 1. O que precisa existir

Quatro recursos. Não seis.

| Recurso | Tipo no Coolify | Origem |
|---|---|---|
| `lapato-postgres` | Database → PostgreSQL 16 | gerenciado pelo Coolify |
| `lapato-api` | Application → Dockerfile | `infra/Dockerfile.api` |
| `lapato-web` | Application → Dockerfile | `infra/Dockerfile.web` |
| `lapato-worker` | Application → Dockerfile | `infra/Dockerfile.worker` |

**Redis e MinIO não entram.** Eles apareciam no Compose antigo e no
`.env.example`, mas nenhuma linha de código os usa — não estão nas dependências
nem no schema de validação do `env.ts`. Subir os dois hoje seria pagar RAM,
disco e backup por serviços com que ninguém fala. Eles voltam quando o M16
(imagens) e as filas do M07 existirem de verdade.

---

## 2. Banco

Crie o PostgreSQL 16 pelo Coolify e anote a **URL interna** que ele gera — é ela
que os três aplicativos usam. A URL pública fica desligada: o banco não precisa
de porta exposta.

### O usuário da aplicação

O Coolify cria um único usuário, que é dono do schema. **Isso não basta**: o
ADR 0002 e o Blueprint §7 exigem que a aplicação rode com um usuário **sem
`BYPASSRLS`** — caso contrário a RLS não isola nada, porque o dono do schema
passa por cima de qualquer policy.

#### Antes: gere a senha em hexadecimal

```bash
openssl rand -hex 32
```

**Não use um gerador de senha com símbolos.** Esta senha vai dentro de uma URI
(`postgres://usuario:SENHA@host/banco`), e ali `#` corta a string no meio — o que
vier depois vira fragmento e some — enquanto `%` inicia escape percentual e `@`,
`/` e `:` mudam o significado da URL. Hexadecimal tem 128 bits de entropia em 32
caracteres e não precisa de escape nem no shell nem na URL.

#### Rodando o SQL

O terminal do Coolify abre um **shell dentro do container** (`/ #`), não uma
sessão `psql`. Colar SQL direto ali faz o `sh` tentar executar `CREATE` como
programa e responder `not found` — o banco não é tocado.

Descubra os nomes reais, que o Coolify gerou:

```sh
env | grep POSTGRES
```

Depois rode cada comando usando essas variáveis — assim não há placeholder para
substituir à mão:

```sh
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE lapato_app LOGIN PASSWORD 'COLE_A_SENHA_HEX' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;"

psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "GRANT CONNECT ON DATABASE \"$POSTGRES_DB\" TO lapato_app;" \
  -c "GRANT USAGE ON SCHEMA public TO lapato_app;" \
  -c "ALTER DEFAULT PRIVILEGES FOR ROLE \"$POSTGRES_USER\" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lapato_app;" \
  -c "ALTER DEFAULT PRIVILEGES FOR ROLE \"$POSTGRES_USER\" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO lapato_app;"
```

Cada comando responde `CREATE ROLE`, `GRANT` ou `ALTER DEFAULT PRIVILEGES`.
Qualquer outra coisa é erro — `ON_ERROR_STOP=1` interrompe na primeira falha em
vez de seguir e deixar metade aplicada.

Se preferir uma sessão interativa, `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"`
abre o prompt `=#`, onde o SQL pode ser colado normalmente. Saia com `\q`.

A partir daí existem **duas** URLs, e a diferença entre elas é a fronteira de
segurança do sistema:

- `DATABASE_URL` → `lapato_app`. É a que a API e o worker usam. Sem `BYPASSRLS`.
- `DATABASE_MIGRATION_URL` → usuário do Coolify (dono do schema). Só migrations
  e provisionamento.

Confira depois de aplicar as migrations — precisa devolver `f`:

```sh
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'lapato_app';"
```

Se devolver `t`, ou se a consulta não devolver linha nenhuma, o isolamento entre
instituições não existe. Pare e corrija.

---

## 3. Roteamento: por que os dois ficam no mesmo domínio

| Aplicativo | Domínio no Coolify | Porta |
|---|---|---|
| `lapato-web` | `https://app.lapato.com.br` | 8080 |
| `lapato-api` | `https://app.lapato.com.br/api` | 3000 |

Front e API **compartilham o host de propósito**. Isso não é economia de
subdomínio: é o que sustenta três decisões de segurança de uma vez.

- o cookie de sessão fica **host-only** — não precisa de `Domain=.lapato.com.br`,
  que o entregaria a qualquer subdomínio, inclusive um comprometido;
- **não há CORS** — nada de `Access-Control-Allow-Credentials` numa lista de
  origens que alguém vai ampliar sem pensar;
- `SameSite=Lax` continua **protegendo contra CSRF**. Entre domínios irmãos
  (`api.` e `app.`) o Lax deixa de distinguir, e aí seria preciso implementar
  token de CSRF explícito.

Separar em `api.lapato.com.br` passa a fazer sentido quando entrar M2M com
bearer token, onde não existe cookie. Hoje, custaria três mecanismos novos para
não ganhar nada.

### O detalhe que dá 404 em tudo

Ao rotear por caminho, o Traefik do Coolify **remove o `/api`** antes de
repassar. O navegador chama `/api/v1/health`, mas o processo recebe
`/v1/health` — verificado em produção neste deploy, não suposto.

Por isso o prefixo é configurável. No `lapato-api`:

```
API_GLOBAL_PREFIX=v1
```

Com a API num **subdomínio próprio** (roteador com `PathPrefix('/')`, como o
domínio gerado em `sslip.io`) nada é removido, e aí o valor é `api/v1`. Ou seja:
o prefixo acompanha o formato do domínio, não o ambiente.

| Domínio da API | Traefik remove? | `API_GLOBAL_PREFIX` |
|---|---|---|
| `app.lapato.com.br/api` | sim | `v1` |
| `api-xyz.sslip.io` | não | `api/v1` |

#### Descobrindo em qual caso você está

O sintoma de errar é 404 em toda rota, inclusive `/health`. Estes dois comandos
separam as causas:

```sh
curl -s https://app.lapato.com.br/api/v1/health
curl -s https://app.lapato.com.br/api/api/v1/health   # /api duplicado, de propósito
```

O `/api` duplicado parece absurdo e é o teste decisivo: se o proxy remove um
deles, a aplicação recebe o caminho certo e responde `{"status":"ok"}`.

Leia o **corpo**, não só o código de status:

| Resposta | Causa | Conserto |
|---|---|---|
| o duplicado devolve `{"status":"ok"...}` | o proxy remove o `/api` | `API_GLOBAL_PREFIX=v1` |
| `{"type":".../erros/404","detail":"Cannot GET /v1/health"}` | idem — o `detail` mostra o caminho que chegou | `API_GLOBAL_PREFIX=v1` |
| `404 page not found` seco | o Traefik não achou rota; o domínio não está na aplicação | configurar o domínio |

O `detail` da resposta é a evidência direta: ele diz qual caminho o processo
recebeu, e não exige adivinhação.

---

## 4. Variáveis por aplicativo

### `lapato-api`

```bash
NODE_ENV=production
LOG_LEVEL=info

API_PORT=3000
API_GLOBAL_PREFIX=v1          # ver §3
API_CORS_ORIGINS=https://app.lapato.com.br

DATABASE_URL=postgres://lapato_app:<senha>@<host-interno>:5432/<banco>

SESSION_SECRET=<openssl rand -hex 32>
SESSION_TTL_HOURS=12
SESSION_COOKIE_NAME=lapato_session
SESSION_COOKIE_SECURE=true
MFA_ISSUER=LAPATO

COPILOT_PROVIDER=stub

# PDF do laudo (M11) e, mais tarde, imagens (M16) - ver ADR de storage.
STORAGE_PROVIDER=r2
# As tres credenciais abaixo vem do token R2 criado no painel da Cloudflare.
R2_ACCOUNT_ID=<preencher>
R2_ACCESS_KEY_ID=<preencher>
R2_SECRET_ACCESS_KEY=<preencher>
R2_BUCKET=lapato-producao

# Base do front - monta a URL que o QR Code do laudo aponta (M11 seção 88).
WEB_PUBLIC_URL=https://app.lapato.com.br
```

### `lapato-worker`

```bash
NODE_ENV=production
LOG_LEVEL=info
DATABASE_URL=postgres://lapato_app:<senha>@<host-interno>:5432/<banco>
```

O worker lê só isso. Ele consulta `outbox_evento` em laço, com back-off — não
depende de fila externa.

### `lapato-web`

Nenhuma. O front é estático: `VITE_API_BASE_URL=/api/v1` é fixado no build
(`infra/Dockerfile.web`), porque a SPA fala com a API pelo mesmo host.

### O que a aplicação recusa

O processo morre na subida, dizendo qual campo falta, se:

- `SESSION_SECRET` tiver menos de 32 caracteres;
- `NODE_ENV=production` com `SESSION_COOKIE_SECURE=false`;
- `COPILOT_PROVIDER=claude` sem `ANTHROPIC_API_KEY`;
- `STORAGE_PROVIDER=r2` sem as quatro credenciais do R2;
- `DATABASE_URL` ausente.

É deliberado: melhor o container morrer imediatamente do que atender request com
sessão insegura.

---

## 5. Build e migrations

Nos três aplicativos, o **Build Pack é `Dockerfile`**, com:

| Campo | `lapato-api` | `lapato-web` | `lapato-worker` |
|---|---|---|---|
| Base Directory | `/` | `/` | `/` |
| Dockerfile Location | `/infra/Dockerfile.api` | `/infra/Dockerfile.web` | `/infra/Dockerfile.worker` |
| Porta exposta | 3000 | 8080 | — (sem domínio) |

O **Base Directory precisa ser a raiz** do repositório: os três Dockerfiles são
multi-stage sobre o monorepo inteiro e copiam `pnpm-workspace.yaml` e os
`package.json` de vários pacotes. Apontar para `/infra` quebra o build no
primeiro `COPY`.

### Migrations antes do código novo

No `lapato-api`, em **Pre-deployment Command**:

```
node node_modules/@lapato/db/dist/cli/migrate.js
```

Esse caminho não é palpite: a imagem é montada com `pnpm deploy`, então os
comandos ficam em `node_modules/@lapato/db/dist/cli/`, junto da pasta `drizzle/`.

O pré-deploy precisa da URL do dono do schema — acrescente ao `lapato-api`:

```bash
DATABASE_MIGRATION_URL=postgres://<usuario-do-coolify>:<senha>@<host>:5432/<banco>
```

Rodar migration antes do código novo é o que permite rollback: toda migration
precisa ser compatível com a versão anterior da aplicação — coluna nova sempre
opcional, criar antes de remover, nunca renomear em um passo só.

---

## 6. Primeira subida, na ordem

1. Criar o Postgres e rodar o SQL da §2.
2. Subir o `lapato-api`. O pré-deploy aplica migrations, RLS e os triggers de
   imutabilidade.
3. Conferir o `rolbypassrls` da §2.
4. Provisionar a instituição real (§7).
5. Subir `lapato-web` e `lapato-worker`.

### Verificação

```bash
curl -fsS https://app.lapato.com.br/api/v1/health          # {"status":"ok","banco":"ok"}
curl -o /dev/null -w '%{http_code}\n' \
     https://app.lapato.com.br/api/v1/fluxo/casos          # 401
curl -sI https://app.lapato.com.br | head -1               # 200, a SPA
```

O `401` é sinal de saúde, não de erro: a rota protegida está negando por padrão.

Se o `/health` devolver **404**, é o `API_GLOBAL_PREFIX` da §3 — troque entre
`v1` e `api/v1` e reimplante.

---

## 7. Criar a instituição real

No terminal do `lapato-api` dentro do Coolify:

```bash
PROVISION_TENANT_SLUG=lapato \
PROVISION_RAZAO_SOCIAL="LAPATO Necropsia Veterinária LTDA" \
PROVISION_ADMIN_NOME="<nome>" \
PROVISION_ADMIN_EMAIL="<e-mail>" \
node node_modules/@lapato/db/dist/cli/provision.js
```

A saída traz a **senha inicial** e a **URI do TOTP**, uma única vez cada. Guarde
as duas antes de fechar o terminal: não há recuperação de MFA.

O primeiro login tem três etapas — senha, código de 6 dígitos e definição da
senha definitiva. Detalhes e variáveis aceitas em `runbook-deploy.md` §3.

> **Se o tenant `demo` existir em produção, apague-o.** Ele vem do
> `pnpm db:seed`, cujo usuário e senha (`admin@lapato.local` / `lapato123`) estão
> em texto puro num repositório público.

---

## 8. Backup

O Coolify faz backup agendado do PostgreSQL gerenciado, com destino S3. Ligue,
e depois **restaure uma vez** num banco descartável antes do go-live — backup
que nunca foi restaurado não é backup. O tempo que a restauração levar é o seu
RTO.

O que mais precisa sair da máquina: as variáveis de ambiente dos três
aplicativos. Elas vivem só no Coolify; guarde uma cópia no cofre.

`infra/backup.sh` continua servindo para dump manual cifrado com GPG, se você
quiser uma cópia independente do Coolify.

---

## 9. O que este arranjo perde em relação ao Compose

Honestidade sobre o outro lado da troca:

- **Ordem de subida não existe mais.** Não há `depends_on`. Na prática não
  atrapalha: a conexão do Postgres é preguiçosa, a API sobe sem banco e o worker
  faz back-off e tenta de novo. O que se perde é o diagnóstico bonito — em vez
  de "esperando o postgres", aparece erro de conexão no log até o banco existir.
- **As variáveis compartilhadas viram duas cópias.** `DATABASE_URL` está no
  `lapato-api` e no `lapato-worker`. Trocar a senha do banco exige lembrar dos
  dois. É o preço de recursos independentes.
- **Subir tudo do zero deixa de ser um comando.** São quatro recursos criados
  na interface. Em compensação, atualizar um serviço não toca nos outros.
