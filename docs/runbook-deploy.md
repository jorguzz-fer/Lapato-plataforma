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
docker compose -f infra/docker-compose.yml run --rm api node dist/cli/migrate.js

# Sobe a aplicação
docker compose -f infra/docker-compose.yml up -d --build
```

### Criando a primeira instituição

O `pnpm db:seed` **não serve para produção** — ele cria senhas conhecidas e
recusa rodar com `NODE_ENV=production`. A instituição real é criada à mão:

```bash
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U lapato_owner -d lapato -c \
  "INSERT INTO tenant (slug, razao_social, nome_fantasia)
   VALUES ('lapato', 'LAPATO Necropsia Veterinária LTDA', 'LAPATO');"
```

O `slug` é o que os usuários digitam no login. Anote-o.

Depois: criar unidade, perfis, permissões e o primeiro administrador. Um comando
de provisionamento (`pnpm db:provision`) ainda não existe — é o primeiro item da
lista de melhorias operacionais.

### Verificação

```bash
curl -fsS https://app.lapato.com.br/api/v1/health     # {"status":"ok","banco":"ok"}
curl -o /dev/null -w '%{http_code}\n' https://app.lapato.com.br/api/v1/fluxo/casos   # 401
curl -sI http://app.lapato.com.br | head -1           # 308, redirecionando para HTTPS
```

O `401` é sinal de saúde, não de erro: significa que a rota protegida está
negando por padrão.

---

## 4. Deploys seguintes

```bash
cd Lapato-plataforma
git pull

# Migrations antes do código novo: o schema precisa ser compatível com as duas versões.
docker compose -f infra/docker-compose.yml run --rm api node dist/cli/migrate.js
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
