# LAPATO

**Sistema Integrado de Gestão Anatomopatológica Veterinária.**

Plataforma que organiza a rotina completa de um laboratório de patologia
veterinária em torno de uma única unidade de informação: o **Caso
Anatomopatológico**. Do cadastro da amostra à liberação do laudo, tudo o que
acontece fica vinculado ao mesmo dossiê, com linha do tempo única e auditável.

---

## Estado atual

Esta é a **fase 1**: fundação técnica mais uma fatia vertical funcionando de
ponta a ponta. O que já roda:

```
Cadastro → Recebimento → Triagem → Macroscopia → Cassetes
   → Envio ao laboratório de apoio → Lâminas
   → Microscopia → Laudo → Revisão → Assinatura → Liberação
```

Consulte [`docs/modulos/README.md`](docs/modulos/README.md) para o estado de cada
um dos 26 módulos oficiais e o mapa de-para da numeração dos documentos.

---

## Começando

Pré-requisitos: **Node 22 LTS**, **pnpm 10** e **Docker**.

```bash
cp .env.example .env
# Gere um segredo de sessão real:
#   openssl rand -hex 32   → cole em SESSION_SECRET

pnpm install
docker compose -f infra/docker-compose.yml up -d postgres redis minio minio-init

pnpm db:migrate   # schema + políticas de RLS + triggers de imutabilidade
pnpm db:seed      # instituição de demonstração

pnpm dev          # API em :3000, front em :5173
```

A documentação da API fica em `http://localhost:3000/api/docs`.

### Usuários de demonstração

Instituição `demo`, senha `lapato123` para todos:

| E-mail | Perfil | Observação |
|---|---|---|
| `admin@lapato.local` | Administrador Geral | |
| `recepcao@lapato.local` | Recepção | |
| `tecnico@lapato.local` | Técnico de Laboratório | |
| `patologista@lapato.local` | Patologista | assina e libera laudo |
| `residente@lapato.local` | Residente | elabora, mas **não** assina nem libera |
| `apoio@lapato.local` | Laboratório de Apoio | externo, só vê o processamento |

O seed recusa rodar com `NODE_ENV=production` — ele cria senhas conhecidas.

---

## Estrutura

```
apps/
  api/            NestJS — BFF e API v1; único serviço público
  web/            React + Vite — shell interno do laboratório
  worker/         Consumidor do outbox: eventos, notificações, jobs
packages/
  shared/         Tipos, enums de domínio, contratos de evento, cálculo de prazo
  db/             Schema Drizzle, migrations, RLS, seed
  design-tokens/  Identidade visual (ADR 0006)
infra/            Docker Compose, Dockerfiles, Caddy
docs/adr/         Decisões arquiteturais
docs/modulos/     Numeração oficial e escopo por módulo
```

---

## As quatro leis da arquitetura

Vêm de `0 DIRETRIZES DE INTEGRAÇÃO.docx` e valem para todo módulo novo.

**1. Fonte única de verdade.** Um dado tem uma origem oficial. Os demais módulos
consultam por referência; nenhum guarda cópia. O endereço de uma clínica pertence
ao M03 — Logística, Financeiro e Portal apenas leem.

**2. Módulo proprietário.** Quem cria o dado é quem valida, versiona e controla o
acesso a ele. Uma pendência é criada no M10, exibida no M07, mostrada ao
patologista no M11 e parcialmente visível no M04 — **uma pendência, não cinco
registros**.

**3. Integração por eventos.** Módulos não se chamam diretamente. Ao liberar um
laudo, o patologista executa uma ação; atualizar o fluxo, publicar no Portal,
notificar e registrar auditoria são consequências automatizadas.

**4. Dossiê e linha do tempo únicos.** Abrir um caso leva sempre ao mesmo dossiê,
venha de que módulo vier. A timeline pertence à infraestrutura de rastreamento e
não é reproduzida por módulo.

---

## Segurança

O `Engineering Blueprint.md` é lei aqui. O que isso significa na prática:

- **Isolamento entre instituições** com `tenant_id` + Row-Level Security. A
  aplicação filtra **e** o banco barra; o usuário de banco não tem `BYPASSRLS`.
  Há teste automatizado provando que o tenant A não lê nem escreve no tenant B —
  inclusive com consultas sem filtro (ADR 0002).
- **Autorização sempre no servidor.** As permissões que o front recebe servem
  para esconder o que o usuário não pode fazer; quem decide é a API, a cada
  request.
- **Sessão em cookie httpOnly**, Argon2id, MFA TOTP, lockout progressivo e
  respostas de login que não revelam se a conta existe.
- **Trilha imutável**: `evento_dominio` e `audit_log` recusam UPDATE e DELETE por
  trigger. Erro gera evento de correção, nunca exclusão.
- **Um único ingress público** (Caddy, 443). Postgres, Redis, MinIO e worker não
  publicam portas.

---

## Inteligência artificial

Os três componentes do M17 têm papéis distintos, e apenas um depende de modelo:

- **LAPATO Guardian** — determinístico, sem LLM. Verifica identidade,
  lateralidade cadastro × laudo, margem estruturada × texto, completude e
  coerência. Um achado `crítico` **bloqueia** a ação (a assinatura de um laudo com
  lateralidade divergente é barrada com 409 e o achado estruturado).
- **LAPATO Copiloto** — atrás da interface `CopilotProvider`, hoje com provedor
  `stub`. O painel lateral 70/30 já existe e mostra "Assistência de IA
  temporariamente indisponível".
- **Memória Anatomopatológica** — fase posterior.

Regra arquitetural do M17 que o código respeita: **o LAPATO funciona sem IA**.
Cadastrar, descrever, diagnosticar, assinar e liberar rodam em modo manual — e
há teste e2e que percorre o fluxo inteiro com o Copiloto desligado.

Antes de ligar um provedor real: minimização de dados, hierarquia de fontes,
isolamento do contexto entre instituições, política de retenção de prompts e DPA
com o provedor. Ver [ADR 0007](docs/adr/0007-ia-guardian-deterministico-copiloto-plugavel.md).

---

## Testes

```bash
pnpm lint          # ESLint
pnpm typecheck     # tsc em todos os pacotes
pnpm test          # 64 testes
```

O que a suíte cobre:

- **`packages/shared`** — numeração hierárquica (caso → recipiente → amostra →
  cassete → bloco → lâmina) e cálculo de prazo em dias úteis com calendário
  institucional e suspensões.
- **`packages/db`** — isolamento entre instituições contra Postgres real,
  cobertura de RLS em todas as tabelas de domínio e imutabilidade da auditoria.
- **`apps/api`** — a fatia vertical completa, o bloqueio do Guardian, a triagem
  bloqueada que impede o avanço do fluxo, o modo sem IA e as restrições de perfil
  (residente não assina; laboratório de apoio não vê dados clínicos).

Os testes de integração precisam de um Postgres com migrations e seed aplicados.

---

## Contribuindo

- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`).
- Decisão arquitetural relevante vira **ADR** em `docs/adr/`.
- Toda tabela de domínio nova nasce com `tenant_id`; a política de RLS é aplicada
  por descoberta, e o teste falha se alguma ficar de fora.
- Módulo novo publica **eventos**; não chama outro módulo direto.
- PR só entra com lint, tipos e testes verdes.

---

## Pendências para o dono do produto

1. **Licença do Taplox.** É template comercial. Como o produto é SaaS
   multi-instituição, uma licença Regular de marketplace não cobre este uso.
   Extraímos apenas tokens (cores, tipografia, métricas) e o pacote-fonte foi
   removido do repositório, o que reduz muito a exposição — mas confirme a
   licença adquirida.
2. **Documentação dos módulos 19 a 26** (Logística, Financeiro, Biblioteca,
   Qualidade e Auditoria, Ensino e Pesquisa, Perícia, Relatórios, Integrações e
   Notificações). Financeiro, Qualidade e Notificações são citados por quase
   todos os módulos já documentados; os pontos de extensão existem, a
   implementação depende da especificação.
3. **Residência de dados e hospedagem.** Recomendamos região Brasil (LGPD). Vira
   ADR quando a hospedagem for escolhida.
4. **DPAs** com terceiros que processarem dados: nuvem, storage, provedor de IA,
   e-mail, WhatsApp, assinatura digital, emissão fiscal.
