# Runbook — operação do LAPATO

Blueprint §16, item 12. Cobre provisionamento, backup, restauração, rollback e as
lacunas conhecidas.

**A topologia de produção mora em [`deploy-coolify.md`](deploy-coolify.md).**
Produção não usa Docker Compose: cada peça é um recurso próprio no Coolify,
construído a partir do seu Dockerfile. Este documento cuida do que vem depois de
a infraestrutura existir.

Domínio de produção: **`app.lapato.com.br`**.

---

## 1. Recursos necessários

### Servidor

Um host com Coolify. Os quatro recursos — Postgres gerenciado, `lapato-api`,
`lapato-web` e `lapato-worker` — rodam nele.

| | Mínimo (piloto) | Recomendado (produção) |
|---|---|---|
| vCPU | 2 | 4 |
| RAM | 4 GB | 8 GB |
| Disco | 60 GB SSD | 120 GB SSD ou mais |
| SO | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |

**Por que a RAM importa mais que a CPU:** Postgres, API, worker e front dividem o
host com o próprio Coolify, que também constrói as imagens ali. Build de imagem
com 2 GB compete com o Postgres em produção — é o momento em que a latência
aparece na tela do usuário.

**Por que o disco vai crescer:** hoje o consumo é modesto (banco pequeno, três
imagens Docker). Quando o M16 entrar, fotografia de macroscopia e microfotografia
acumulam por caso e nunca são apagadas — o M16 proíbe sobrescrever o original.
Nessa hora, object storage externo passa a valer mais que disco local (§6).

### DNS

Um registro só:

```
app.lapato.com.br    A    <IP-do-host>
```

Se o provedor der IPv6, acrescente o `AAAA` para o mesmo host.

**Verifique antes de subir:** o Let's Encrypt precisa resolver o nome e alcançar
a porta 80. DNS ainda propagando faz a emissão falhar, e o Let's Encrypt tem
limite de tentativas por semana.

```bash
dig +short app.lapato.com.br     # deve devolver o IP do host
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

Mais a porta da interface do Coolify, restrita ao seu IP.

O Postgres **não** publica porta: fica na rede interna do Coolify, com a URL
pública desligada. Se algum dia aparecer `5432` aberta no host, é regressão de
segurança.

### Contas e serviços externos

| Serviço | Para quê | Quando |
|---|---|---|
| Provedor de VPS | Hospedagem do Coolify | Agora |
| DNS do domínio | Registro `A` | Agora |
| Destino S3 do backup | Cópia off-site do banco | Antes do go-live |
| Object storage S3 | Imagens do M16 | Quando o M16 entrar |
| Provedor de e-mail | Notificações do M26 | Quando o M26 entrar |
| Anthropic API | Copiloto real (M17) | Quando o Copiloto for ligado |

---

## 2. Variáveis de ambiente

A lista por aplicativo, com os valores de produção, está em
[`deploy-coolify.md` §4](deploy-coolify.md). Em produção elas vivem na interface
do Coolify — nunca em arquivo no repositório.

Gerando os segredos:

```bash
openssl rand -hex 32     # SESSION_SECRET
openssl rand -hex 32     # senha do usuário de banco
```

**Hexadecimal, não base64, para a senha do banco.** Ela viaja dentro de uma URI
(`postgres://usuario:SENHA@host/banco`), e ali `/` e `+` do base64 mudam o
significado da URL — assim como `#`, `%` e `@` de um gerador com símbolos. Hex
tem 128 bits de entropia em 32 caracteres e não precisa de escape em lugar nenhum.

**Redis e S3 não são configurados hoje.** Apareciam aqui e no Compose, mas
nenhuma linha de código os lê — não estão nas dependências nem no schema de
validação do `env.ts`. Voltam quando o M16 e as filas do M07 existirem.

Para desenvolvimento local, copie `.env.example` para `.env` e use
`infra/docker-compose.yml`, que sobe Postgres, os três serviços e o Caddy
mantendo front e API no mesmo host — a mesma origem que produção tem.

---

## 3. Provisionamento

A subida da infraestrutura está em [`deploy-coolify.md` §6](deploy-coolify.md).
O que segue é o que fazer depois que ela responde.

### Criando a primeira instituição

O `pnpm db:seed` **não serve para produção** — ele cria senhas conhecidas e
recusa rodar com `NODE_ENV=production`. A instituição real é criada pelo comando
de provisionamento, no terminal do `lapato-api` dentro do Coolify:

```bash
PROVISION_TENANT_SLUG=lapato \
PROVISION_RAZAO_SOCIAL="LAPATO Necropsia Veterinária LTDA" \
PROVISION_NOME_FANTASIA="LAPATO" \
PROVISION_ADMIN_NOME="Nome do administrador" \
PROVISION_ADMIN_EMAIL="administrador@lapato.com.br" \
node node_modules/@lapato/db/dist/cli/provision.js
```

O caminho `node_modules/@lapato/db/dist/cli/` não é engano: a imagem é montada
com `pnpm deploy`, que instala `@lapato/db` como dependência. Os comandos de
banco vivem lá dentro, junto com a pasta `drizzle/` das migrations.

O comando usa `DATABASE_MIGRATION_URL` — a URL do dono do schema. A aplicação
nunca usa essa URL para atender request: quem atende é `lapato_app`, sem
`BYPASSRLS` (ADR 0002).

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

#### O primeiro login tem três etapas

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
curl -sI http://app.lapato.com.br | head -1           # 301/308, redirecionando para HTTPS
```

O `401` é sinal de saúde, não de erro: significa que a rota protegida está
negando por padrão.

Se o `/health` devolver **404**, o problema é o `API_GLOBAL_PREFIX`: o proxy do
Coolify consome o `/api` ao rotear por caminho. Ver
[`deploy-coolify.md` §3](deploy-coolify.md).

> **Apague o tenant `demo` se ele existir em produção.** Ele vem do
> `pnpm db:seed`, cujo usuário e senha (`admin@lapato.local` / `lapato123`) estão
> em texto puro num repositório público. Enquanto o tenant existir, essa
> credencial vale.

---

## 4. Deploys seguintes e rollback

O Coolify reimplanta a cada push na branch configurada, ou pelo botão da
interface. Cada aplicativo é independente: mudança só no front reimplanta só o
`lapato-web`.

O **Pre-deployment Command** do `lapato-api` roda as migrations antes de o código
novo subir. Isso não é ordem arbitrária — é o que torna o rollback possível.

Depois de cada deploy:

```bash
curl -fsS https://app.lapato.com.br/api/v1/health
```

### Rollback

Pelo Coolify: abrir o aplicativo, escolher o deployment anterior, reimplantar.

**Migrations não voltam sozinhas.** Por isso toda migration precisa ser
compatível com a versão anterior do código: coluna nova sempre opcional, criar
antes de remover, nunca renomear em um passo só. Se a migration for destrutiva, o
rollback exige restaurar o backup — e aí a perda é o intervalo desde a última
cópia.

---

## 5. Backup e restauração

Blueprint §5: backup automatizado, cópia off-site cifrada e **restauração
testada**. Backup que nunca foi restaurado não é backup.

### O que precisa ser salvo

| Item | Onde | Crítico |
|---|---|---|
| Banco Postgres | recurso gerenciado do Coolify | **Sim** |
| Variáveis de ambiente | interface do Coolify | **Sim** — copie para o cofre |
| Imagens e documentos | ainda não existem (M16) | Quando o M16 entrar |

As variáveis são o item que se esquece: elas não estão no repositório, por
decisão, e vivem só no Coolify. Perder o host sem uma cópia delas significa
reconstruir `SESSION_SECRET` e senhas do zero — e um `SESSION_SECRET` novo
derruba todas as sessões.

### Backup agendado

Ligue o backup do PostgreSQL na interface do Coolify, com destino S3. Ele cuida
de agendamento, retenção e cópia off-site.

`infra/backup.sh` continua servindo para uma cópia independente do Coolify: gera
dump comprimido, cifra com GPG e descarta locais com mais de 7 dias. Ele recusa
rodar sem `BACKUP_GPG_RECIPIENT` — o dump carrega dados clínicos, pessoais e
segredos de MFA.

### Restauração — teste antes de precisar

Restaure um dump real num banco descartável **antes do go-live**, e anote quanto
tempo levou: esse número é o seu RTO. Um backup nunca restaurado é uma suposição,
não uma garantia.

### RPO e RTO — a definir

- **RPO** (perda aceitável): com backup diário, até 24 h. Se o laboratório não
  aceitar perder um dia de laudos, é preciso PITR com WAL archiving.
- **RTO** (tempo até voltar): medido no teste de restauração.

Ambos precisam de decisão do dono do produto antes do go-live.

---

## 6. Decisões em aberto

**Object storage.** Não existe hoje, e não faz falta: nenhum código grava
arquivo. Quando o M16 entrar, o volume de imagens cresce sem parar, e a escolha
é entre disco do host e S3 gerenciado (Cloudflare R2 não cobra egress). É troca
de variável de ambiente, sem mudança de arquitetura — decida na hora, com o
volume real do laboratório na mão.

**Residência de dados.** Recomendação: região Brasil, pela LGPD. Confirmar com o
provedor escolhido e registrar como ADR (`docs/dados-pessoais.md`).

**Observabilidade.** Logs estruturados já saem em JSON e o Coolify os agrega.
Métricas, tracing e error tracking (Blueprint §11) ainda não estão instalados.
Painéis, quando entrarem, ficam atrás de VPN — nunca em subdomínio público.

**Staging.** Um segundo conjunto de recursos no mesmo Coolify, apontando para
outra branch e outro banco. O Blueprint §5 pede paridade dev/prod; sem staging,
o primeiro teste de um deploy acontece em produção. Com recursos independentes
isso ficou mais barato do que era com Compose.

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
