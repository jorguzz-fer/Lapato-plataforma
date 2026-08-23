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
| Cloudflare R2 | PDF do laudo (M11); imagens do M16 reaproveitam o mesmo bucket depois | Antes do go-live |
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

**Redis ainda não é configurado.** Aparece no Compose, mas nenhuma linha de
código o lê — não está nas dependências nem no schema de validação do
`env.ts`. Volta quando as filas do M07 existirem.

**Storage já é o R2, desde o M11.** `STORAGE_PROVIDER=local` grava em disco e é
o padrão de dev/teste — o mesmo espírito do `COPILOT_PROVIDER=stub`, sem exigir
credencial de nuvem para rodar a suíte ou subir localmente. Em produção o valor
é `r2`, com as quatro credenciais da Cloudflare (`R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) — a aplicação recusa
subir com `STORAGE_PROVIDER=r2` e alguma delas faltando. Hoje guarda o PDF do
laudo; o M16 (imagens) reaproveita o mesmo bucket depois, sem precisar de novo
provedor.

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

### 3.1 Redefinindo a senha de alguém

Para quando o acesso se perdeu e não há ninguém de dentro para restaurar: a
senha do provisionamento foi anotada errado, o administrador saiu, a conta
travou por tentativas.

```bash
RESET_TENANT_SLUG=lapato \
RESET_EMAIL=administrador@lapato.com.br \
node node_modules/@lapato/db/dist/cli/redefinir-senha.js
```

Sorteia uma senha, imprime **uma vez**, marca a troca obrigatória no próximo
login e zera o contador de tentativas — porque senha nova não adianta se a conta
segue travada pelos erros anteriores.

| Variável | Efeito |
|---|---|
| `RESET_SENHA` | usa esta em vez de sortear (mín. 16 caracteres) |
| `RESET_MFA=limpar` | remove o segundo fator; o próximo login pede novo cadastro |
| `RESET_REATIVAR=sim` | volta o `status` para `ativo` |

**Status e MFA não mudam sem pedido explícito.** Conta suspensa foi suspensa por
um motivo, e limpar o segundo fator de quem não pediu enfraquece a conta em vez
de recuperá-la. Quando o status impede o login, o comando avisa em vez de deixar
você descobrir na tela.

Isto substitui o `UPDATE` manual em `senha_hash`, que era o procedimento
anterior e tinha uma armadilha silenciosa: o hash começa com `$argon2id`, e
colado em shell entre aspas duplas o `$` é expandido — o hash entra corrompido e
o login falha com "credenciais inválidas", sem pista da causa.

### 3.2 Vinculando lotes sem laboratório de apoio

Necessário uma única vez, para instituições que enviaram lotes **antes** de o
portal do laboratório de apoio existir. Naquele momento o destino era opcional;
depois que o parceiro passou a enxergar apenas os próprios lotes, um lote sem
destino ficou invisível dos dois lados — e não há tela que o corrija, porque o
envio acontece uma vez.

```bash
# 1. sem o slug, ele lista as instituições existentes
node node_modules/@lapato/db/dist/cli/vincular-lotes.js

# 2. confere o que faria, sem gravar
VINCULO_TENANT_SLUG=lapato VINCULO_SIMULAR=sim \
node node_modules/@lapato/db/dist/cli/vincular-lotes.js

# 3. grava
VINCULO_TENANT_SLUG=lapato \
node node_modules/@lapato/db/dist/cli/vincular-lotes.js
```

| Variável | Efeito |
|---|---|
| `VINCULO_TENANT_SLUG` | instituição; ausente, o comando lista as existentes |
| `VINCULO_LABORATORIO_ID` | destino, obrigatório quando há mais de um laboratório |
| `VINCULO_SIMULAR=sim` | mostra o plano sem gravar |

**Não adivinha o destino** quando há mais de um laboratório cadastrado: escolher
errado manda material para o parceiro errado, e desfazer exige outro comando.
Nesse caso ele lista as opções com os ids e para.

Como os demais, é comando e não `UPDATE` no terminal do banco: o schema roda com
`FORCE ROW LEVEL SECURITY`, então sem declarar o tenant antes até o dono das
tabelas enxerga zero linhas. Um `UPDATE` colado à mão responde `UPDATE 0` e
parece não ter encontrado nada — quando na verdade nem chegou a olhar.

### 3.3 Sincronizando perfis com a base institucional

Necessário quando uma versão nova acrescenta permissões aos perfis padrão —
instituições existentes ficam com a foto do dia em que foram provisionadas.
Exemplo real: `laudo:revisar` e `laudo:corrigir` entraram no perfil de
patologista depois do provisionamento; sem a sincronização, o ciclo de revisão
só existe para instituições novas.

```bash
# sem o slug, lista as instituições
node node_modules/@lapato/db/dist/cli/sincronizar-perfis.js

# confere o que faria
SINCRONIZAR_TENANT_SLUG=lapato SINCRONIZAR_SIMULAR=sim \
node node_modules/@lapato/db/dist/cli/sincronizar-perfis.js

# grava
SINCRONIZAR_TENANT_SLUG=lapato \
node node_modules/@lapato/db/dist/cli/sincronizar-perfis.js
```

**Estritamente aditivo**: insere o que falta nos perfis padrão e não remove
nada — o que a instituição acrescentou por conta própria é configuração dela.
Perfil padrão que a instituição removeu **não** é recriado. A permissão nova
vale na próxima sessão de cada usuário.

### 3.4 Workflow padrão da modalidade (uma vez, ao atualizar para o M01)

Instituições provisionadas antes do M01 têm o workflow "Histopatologia padrão"
amarrado ao serviço HISTO específico — um desvio: as etapas condicionais já
consultam as flags de cada serviço, então ele sempre foi, na prática, o padrão
da modalidade. Sem o ajuste, **todo serviço novo criado pela tela de
Administração recusa casos** com "Nenhum workflow ativo para a modalidade".

No terminal do banco (com o tenant declarado, por causa da RLS):

```sql
SET app.current_tenant = '<id do tenant>';   -- SELECT id FROM tenant WHERE slug='lapato';
UPDATE definicao_workflow SET servico_id = NULL WHERE nome = 'Histopatologia padrão';
```

Instituições provisionadas já com o M01 nascem corretas — o ajuste é só para as
anteriores, uma única vez.

### 3.5 Populando a equipe inicial

O `provision` cria só o administrador. Para a instituição começar a operar, o
comando abaixo cria **um usuário por perfil padrão** (recepção, técnico,
patologista, residente e laboratório de apoio), cada um com **senha provisória
aleatória e troca obrigatória** — impressa uma única vez, na tela de quem rodou.
MFA não é semeado: quem assina cadastra o próprio TOTP no primeiro acesso,
guiado pelo funil de sessão.

```bash
EQUIPE_TENANT_SLUG=lapato \
EQUIPE_EMAIL_DOMINIO=minhaclinica.com.br \
EQUIPE_CRMV="CRMV-CE 12345" \
node node_modules/@lapato/db/dist/cli/popular-equipe.js
```

- `EQUIPE_EMAIL_DOMINIO` monta os e-mails (`recepcao@<domínio>`, ...).
- `EQUIPE_CRMV` (opcional) registra a identificação profissional do
  patologista — é ela que sai na assinatura do PDF do laudo (M11 §82).
- **Idempotente por e-mail**: rodar de novo pula quem já existe.
- A conta de apoio exige uma unidade do tipo `laboratorio_apoio`; sem ela, o
  comando avisa e segue — crie a unidade em Administração → Unidades e rode de
  novo.

As contas nascem com o nome do perfil ("Patologista (conta inicial)").
**Renomeie para a pessoa real na tela de Usuários** — ou crie as contas
individuais por lá e bloqueie estas. M02 §3: uma conta é uma pessoa, não uma
função; estas existem para a instituição começar, não para ficar.

### 3.6 Sincronizando os workflows de modalidade

Necessário quando uma versão nova acrescenta uma **modalidade** — a
citopatologia entrou com o M12, e instituição provisionada antes não tem o
workflow dela. Sem isso, cadastrar um caso citológico devolve `400` com
"Nenhum workflow ativo para a modalidade citopatologia".

```bash
# sem o slug, lista as instituições
node node_modules/@lapato/db/dist/cli/sincronizar-workflows.js

# confere o que faria
SINCRONIZAR_TENANT_SLUG=lapato SINCRONIZAR_SIMULAR=sim \
node node_modules/@lapato/db/dist/cli/sincronizar-workflows.js

# grava
SINCRONIZAR_TENANT_SLUG=lapato \
node node_modules/@lapato/db/dist/cli/sincronizar-workflows.js
```

**Só preenche ausência.** Modalidade que já tem workflow padrão ativo é deixada
como está, inclusive com etapas que a instituição tenha alterado — o fluxo
configurado é decisão dela. Vale para casos cadastrados a partir de então; casos
já abertos seguem no workflow em que nasceram.

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

**Object storage — decidido (ADR 0009).** Cloudflare R2, atrás da interface
`StorageProvider`: guarda os PDFs dos laudos assinados e, desde o M16, as
imagens do acervo. O provedor não está mais em aberto; o que fica é a política
de retenção e classe de armazenamento, que só faz sentido decidir com o volume
real do laboratório na mão — fotografia de macroscopia cresce sem parar, e o
original nunca é descartado (M16 §22).

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

Nenhuma bloqueia a operação, mas todas aparecem no primeiro mês de uso real.
Estão aqui para que ninguém descubra na hora errada.

**Não existe autoatendimento de recuperação de MFA.** Quem troca de celular sem
migrar o segredo perde o acesso, e quem restaura é alguém com terminal: o
`redefinir-senha` com `RESET_MFA=limpar` (§3.1) limpa o segundo fator para que o
próximo login cadastre outro. Também não existe rota para *substituir* um fator
já ativo pela interface — isso exigiria provar posse do fator antigo, e sem essa
prova um cookie roubado trocaria o MFA da vítima. A rota devolve `409` até que
essa prova exista.

**Não existe convite de usuário por e-mail.** O administrador cria a conta na
tela de Usuários e recebe a senha provisória na hora, para entregar à pessoa
pelo canal que preferir — o funil de sessão exige a troca no primeiro acesso
(M02 §31). O que falta é o convite propriamente dito: link enviado por e-mail,
com a pessoa definindo a própria senha sem que ninguém mais a conheça. O schema
já prevê `status = 'aguardando_ativacao'` e `senha_hash` nulo para esse fluxo,
que depende do M26 (Notificações) para entregar a mensagem.

**Não existe "esqueci minha senha" pelo próprio usuário.** Há troca de senha
(com a senha atual em mãos) e há redefinição administrativa — pela tela de
Usuários ou, quando ninguém de dentro pode restaurar, pelo comando do §3.1. O
autoatendimento depende do M26 para enviar o link por e-mail.

**O segredo TOTP está em claro no banco.** Quem consegue ler `usuario` consegue
gerar códigos válidos. Cifrar com chave fora do banco é o conserto; enquanto
isso, o backup do banco (que já é cifrado por GPG, ver §5) carrega segredos de
MFA e precisa do mesmo cuidado das credenciais.

As duas primeiras têm o mesmo destravamento: o M26, que entrega e-mail. Enquanto
ele não existe, a senha provisória viaja pela mão de quem administra — o que é
aceitável para começar, e não é onde se quer ficar.
