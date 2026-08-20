# Runbook — deploy do LAPATO

Blueprint §16, item 12. Cobre o primeiro deploy, os deploys seguintes, backup,
restauração e rollback.

Domínio de produção: **`app.lapato.com.br`**.

---

## 1. Recursos necessários

### Servidor

VPS única com Docker, rodando tudo via Compose (Blueprint §5: começar simples,
orquestrar só quando a escala justificar).

| | Mínimo (piloto) | Recomendado (produção) |
|---|---|---|
| vCPU | 2 | 4 |
| RAM | 4 GB | 8 GB |
| Disco | 80 GB SSD | 160 GB SSD ou mais |
| SO | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |

**Por que a RAM importa mais que a CPU:** Postgres, Redis, MinIO, API, worker,
front e Caddy sobem no mesmo host. Com 2 GB o Postgres começa a competir por
memória e a latência das filas do M07 aparece na tela do usuário.

**Por que o disco cresce:** imagens do M16 são o maior consumidor. Fotografia de
macroscopia e microfotografia acumulam por caso e nunca são apagadas — o M16
proíbe sobrescrever o original. Estime o volume real do laboratório antes de
dimensionar, e monitore o uso desde o primeiro mês.

### DNS

Um registro só:

```
app.lapato.com.br    A    <IP-da-VPS>
```

Se o provedor der IPv6, acrescente o `AAAA` para o mesmo host.

**Verifique antes de subir:** o Let's Encrypt precisa resolver o nome e alcançar
a porta 80. DNS ainda propagando faz a emissão falhar, e o Let's Encrypt tem
limite de tentativas por semana.

```bash
dig +short app.lapato.com.br     # deve devolver o IP da VPS
```

### Firewall

Só três portas abertas — Blueprint §5:

```bash
ufw default deny incoming
ufw allow 22/tcp     # SSH; restrinja ao seu IP se possível
ufw allow 80/tcp     # desafio ACME e redirecionamento para HTTPS
ufw allow 443/tcp
ufw enable
```

Postgres, Redis e MinIO **não** publicam portas: vivem na rede interna do
Compose. Se algum dia aparecer `5432` aberta no host, é regressão de segurança.

### Contas e serviços externos

| Serviço | Para quê | Quando |
|---|---|---|
| Provedor de VPS | Hospedagem | Agora |
| DNS do domínio | Registro `A` | Agora |
| Object storage S3 (opcional) | Alternativa ao MinIO local | Ver §6 |
| Provedor de e-mail | Notificações do M26 | Quando o M26 entrar |
| Anthropic API | Copiloto real (M17) | Quando o Copiloto for ligado |

---

## 2. Variáveis de ambiente de produção

Crie o `.env` **na VPS**, nunca no repositório.

```bash
# --- Ambiente ---
NODE_ENV=production
LOG_LEVEL=info

# --- Domínio e TLS ---
SITE_ADDRESS=app.lapato.com.br
ACME_EMAIL=<seu-e-mail-para-avisos-do-lets-encrypt>

# --- API ---
API_PORT=3000
API_CORS_ORIGINS=https://app.lapato.com.br

# --- Banco ---
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=lapato
POSTGRES_USER=lapato_app
POSTGRES_PASSWORD=<gerar>
DATABASE_URL=postgres://lapato_app:<a-mesma-senha>@postgres:5432/lapato

POSTGRES_MIGRATOR_USER=lapato_owner
POSTGRES_MIGRATOR_PASSWORD=<gerar>
DATABASE_MIGRATION_URL=postgres://lapato_owner:<a-mesma-senha>@postgres:5432/lapato

# --- Redis ---
REDIS_URL=redis://redis:6379

# --- Object storage ---
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=lapato
S3_ACCESS_KEY_ID=<gerar>
S3_SECRET_ACCESS_KEY=<gerar>
S3_FORCE_PATH_STYLE=true
S3_SIGNED_URL_TTL=300

# --- Sessão ---
SESSION_SECRET=<gerar com: openssl rand -hex 32>
SESSION_TTL_HOURS=12
SESSION_COOKIE_NAME=lapato_session
SESSION_COOKIE_SECURE=true
MFA_ISSUER=LAPATO

# --- IA ---
COPILOT_PROVIDER=stub
```

Gerando os segredos:

```bash
openssl rand -hex 32     # SESSION_SECRET
openssl rand -base64 24  # cada senha e chave
```

Permissão do arquivo:

```bash
chmod 600 .env
```

### O que a aplicação recusa

A validação de ambiente derruba o processo na subida, com a mensagem do campo
que falta, se:

- `SESSION_SECRET` tiver menos de 32 caracteres;
- `NODE_ENV=production` e `SESSION_COOKIE_SECURE=false`;
- `COPILOT_PROVIDER=claude` sem `ANTHROPIC_API_KEY`.

É deliberado: melhor o container morrer imediato do que atender request com
sessão insegura.

---

## 3. Primeiro deploy

```bash
# Na VPS
git clone https://github.com/jorguzz-fer/Lapato-plataforma.git
cd Lapato-plataforma

# Crie o .env com o conteúdo da seção 2
nano .env && chmod 600 .env

# Sobe a infraestrutura primeiro
docker compose -f infra/docker-compose.yml up -d postgres redis minio minio-init

# Schema, RLS e triggers de imutabilidade
docker compose -f infra/docker-compose.yml run --rm api \
  node node_modules/@lapato/db/dist/cli/migrate.js

# Sobe a aplicação
docker compose -f infra/docker-compose.yml up -d --build
```

O caminho `node_modules/@lapato/db/dist/cli/` não é engano: a imagem da API é
montada com `pnpm deploy`, que instala `@lapato/db` como dependência. Os
comandos de banco vivem lá dentro, junto com a pasta `drizzle/` das migrations.

### Criando a primeira instituição

O `pnpm db:seed` **não serve para produção** — ele cria senhas conhecidas e
recusa rodar com `NODE_ENV=production`. A instituição real é criada pelo
comando de provisionamento:

```bash
docker compose -f infra/docker-compose.yml run --rm \
  -e PROVISION_TENANT_SLUG=lapato \
  -e PROVISION_RAZAO_SOCIAL="LAPATO Necropsia Veterinária LTDA" \
  -e PROVISION_NOME_FANTASIA="LAPATO" \
  -e PROVISION_ADMIN_NOME="Nome do administrador" \
  -e PROVISION_ADMIN_EMAIL="administrador@lapato.com.br" \
  api node node_modules/@lapato/db/dist/cli/provision.js
```

Ele cria, numa transação só: a instituição, a unidade sede, os cinco setores, as
tabelas mestres, os três serviços, os modelos de etiqueta, o workflow da
histopatologia, os seis perfis com suas permissões, a política de IA
conservadora e **um único usuário administrador**. Nenhum cliente,
veterinário, paciente ou caso fictício é criado.

**A saída aparece uma única vez e não é recuperável:**

- a **senha inicial**, sorteada com 144 bits de entropia — o banco guarda só o
  hash Argon2id;
- a **URI do TOTP** (`otpauth://...`), que precisa ser cadastrada no aplicativo
  autenticador antes do primeiro login.

MFA vem ligado porque o Blueprint §6 exige TOTP para administradores. Não existe
recuperação de segundo fator, então **perder esse segredo é perder a conta** — só
resta rodar um `UPDATE` direto no banco. Guarde os dois no cofre antes de fechar
o terminal.

O `slug` é o que os usuários digitam no login. Anote-o.

#### O primeiro login tem duas etapas obrigatórias

A senha entregue pelo `provision` vale para **um acesso só**. A sequência é:

1. instituição + e-mail + senha inicial;
2. código de 6 dígitos do aplicativo autenticador;
3. **definir a senha definitiva** — a tela aparece sozinha e nenhuma outra parte
   do sistema responde antes disso.

Se a conta administrativa tiver sido criada com `PROVISION_MFA=off`, a etapa 2
não acontece, mas o sistema exige o cadastro do TOTP logo depois da troca de
senha: o Blueprint §6 vale para quem administra permissões ou assina laudo,
independentemente de como a conta nasceu.

#### Variáveis aceitas

| Variável | Obrigatória | Padrão |
|---|---|---|
| `PROVISION_TENANT_SLUG` | Sim | — (minúsculas, números e hífen) |
| `PROVISION_RAZAO_SOCIAL` | Sim | — |
| `PROVISION_ADMIN_NOME` | Sim | — |
| `PROVISION_ADMIN_EMAIL` | Sim | — |
| `PROVISION_NOME_FANTASIA` | Não | a razão social |
| `PROVISION_CNPJ` | Não | vazio |
| `PROVISION_FUSO` | Não | `America/Fortaleza` |
| `PROVISION_UNIDADE_NOME` | Não | `Unidade Sede` |
| `PROVISION_LAB_APOIO_NOME` | Não | não cria a unidade parceira |
| `PROVISION_ADMIN_CONSELHO` | Não | sem assinatura profissional |
| `PROVISION_ADMIN_SENHA` | Não | senha sorteada (mín. 16 caracteres se informada) |
| `PROVISION_MFA` | Não | ligado; `off` desliga e avisa |

Rodar o comando duas vezes com o mesmo `slug` **falha de propósito**: ele não
sobrescreve dados nem duplica perfis e serviços.

`PROVISION_ADMIN_CONSELHO` só é preenchido para um administrador que também
assina laudo. Sem registro profissional não há assinatura — criar uma vazia
seria dado falso.

#### Provisionando as instituições seguintes

O mesmo comando, com outro `slug`. Cada instituição é um tenant isolado por RLS;
nada é compartilhado entre elas além do schema.

### Verificação

```bash
curl -fsS https://app.lapato.com.br/api/v1/health     # {"status":"ok","banco":"ok"}
curl -o /dev/null -w '%{http_code}\n' https://app.lapato.com.br/api/v1/fluxo/casos   # 401
curl -sI http://app.lapato.com.br | head -1           # 308, redirecionando para HTTPS
```

O `401` é sinal de saúde, não de erro: significa que a rota protegida está
negando por padrão.

### Se o deploy for pelo Coolify

O `infra/docker-compose.coolify.yml` deixa o Traefik do Coolify no lugar do
Caddy e recebe os segredos pela interface, não por arquivo `.env` no repositório.
Migrations e provisionamento continuam sendo os mesmos comandos, executados
dentro do container que já está de pé:

```bash
docker exec -it <container-da-api> \
  node node_modules/@lapato/db/dist/cli/migrate.js

docker exec -it \
  -e PROVISION_TENANT_SLUG=lapato \
  -e PROVISION_RAZAO_SOCIAL="LAPATO Necropsia Veterinária LTDA" \
  -e PROVISION_ADMIN_NOME="Nome do administrador" \
  -e PROVISION_ADMIN_EMAIL="administrador@lapato.com.br" \
  <container-da-api> node node_modules/@lapato/db/dist/cli/provision.js
```

Isso depende de `DATABASE_MIGRATION_URL` estar no ambiente do container — o
compose do Coolify a monta a partir de `POSTGRES_MIGRATOR_USER` e
`POSTGRES_MIGRATOR_PASSWORD`. A aplicação nunca usa essa URL para atender
request: quem atende é `lapato_app`, sem `BYPASSRLS` (ADR 0002).

---

## 4. Deploys seguintes

```bash
cd Lapato-plataforma
git pull

# Migrations antes do código novo: o schema precisa ser compatível com as duas versões.
docker compose -f infra/docker-compose.yml run --rm api \
  node node_modules/@lapato/db/dist/cli/migrate.js
docker compose -f infra/docker-compose.yml up -d --build

docker compose -f infra/docker-compose.yml ps
curl -fsS https://app.lapato.com.br/api/v1/health
```

### Rollback

```bash
git checkout <tag-ou-commit-anterior>
docker compose -f infra/docker-compose.yml up -d --build
```

**Migrations não voltam sozinhas.** Por isso toda migration deve ser compatível
com a versão anterior do código: adicionar coluna nullable em vez de renomear,
criar antes de remover. Se a migration for destrutiva, o rollback exige restaurar
o backup — e aí a perda é o intervalo desde o último dump.

---

## 5. Backup e restauração

Blueprint §5: backup automatizado, cópia off-site cifrada e **restauração
testada**. Backup que nunca foi restaurado não é backup.

### O que precisa ser salvo

| Item | Onde | Crítico |
|---|---|---|
| Banco Postgres | volume `postgres-data` | **Sim** |
| Imagens e documentos | volume `minio-data` | **Sim** |
| Certificados TLS | volume `caddy-data` | Não, mas evita reemissão |
| `.env` | disco da VPS | **Sim** — guarde no cofre, não junto do backup |

### Dump diário

```bash
# /etc/cron.d/lapato-backup
0 3 * * * root /opt/lapato/infra/backup.sh >> /var/log/lapato-backup.log 2>&1
```

Ver `infra/backup.sh`. Ele gera dump comprimido, cifra com GPG e remove locais
com mais de 7 dias. **Copiar para fora da VPS é passo obrigatório** — backup no
mesmo disco não protege contra perda do servidor.

### Restauração — teste antes de precisar

```bash
gpg --decrypt lapato-2026-08-09.sql.gz.gpg | gunzip | \
  docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U lapato_owner -d lapato
```

Faça isso numa VPS descartável, com um dump real, **antes do go-live**. Anote
quanto tempo levou: esse número é o seu RTO.

### RPO e RTO — a definir

- **RPO** (perda aceitável): com dump diário, até 24 h. Se o laboratório não
  aceitar perder um dia de laudos, é preciso PITR com WAL archiving.
- **RTO** (tempo até voltar): medido no teste de restauração.

Ambos precisam de decisão do dono do produto antes do go-live.

---

## 6. Decisões em aberto

**Object storage.** O MinIO local funciona e simplifica o começo, mas o volume
de imagens do M16 cresce sem parar e fica no mesmo disco do banco. Migrar para
S3-compatível gerenciado (Cloudflare R2, sem egress) é troca de variáveis de
ambiente, sem mudança de código. Revisar quando o volume passar de ~50 GB.

**Residência de dados.** Recomendação: região Brasil, pela LGPD. Confirmar com o
provedor escolhido e registrar como ADR (`docs/dados-pessoais.md`).

**Observabilidade.** Logs estruturados já saem em JSON. Métricas, tracing e
error tracking (Blueprint §11) ainda não estão instalados. Painéis, quando
entrarem, ficam atrás de VPN — nunca em subdomínio público.

**Staging.** `staging.lapato.com.br` numa VPS menor, com a mesma configuração
parametrizada. O Blueprint §5 pede paridade dev/prod; sem staging, o primeiro
teste de um deploy acontece em produção.

---

## 7. Lacunas conhecidas de gestão de contas

Nenhuma bloqueia o primeiro deploy, mas todas aparecem no primeiro mês de uso
real. Estão aqui para que ninguém descubra na hora errada.

**Não existe recuperação de MFA.** Um administrador que troque de celular sem
migrar o segredo perde a conta, e o único conserto é `UPDATE` no banco. Também
não existe rota para *substituir* um segundo fator já ativo — isso exigiria
provar posse do fator antigo, e sem essa prova um cookie roubado trocaria o MFA
da vítima. A rota devolve `409` até que essa prova exista.

**Não existe convite de usuário.** O schema já prevê `status =
'aguardando_ativacao'` e `senha_hash` nulo, mas não há fluxo que ative a conta —
uma conta criada assim fica inacessível. Por isso o `provision` cria o
administrador já `ativo`, e por isso ainda não há como um administrador criar o
segundo usuário pela interface. Hoje isso é `INSERT` manual.

**Não existe recuperação de senha esquecida.** Há troca de senha (com a senha
atual em mãos), mas não há "esqueci minha senha" — que depende do M26
(Notificações) para enviar o link.

**O segredo TOTP está em claro no banco.** Quem consegue ler `usuario` consegue
gerar códigos válidos. Cifrar com chave fora do banco é o conserto; enquanto
isso, o backup do banco (que já é cifrado por GPG, ver §5) carrega segredos de
MFA e precisa do mesmo cuidado das credenciais.

O caminho para fechar as três primeiras é o mesmo: gestão de usuários no M02
(convite, ativação, reset administrativo), que por sua vez depende do M26 para
entregar os e-mails.
