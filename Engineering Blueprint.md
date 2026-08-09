# Engineering Blueprint — Padrão de boas práticas para novos projetos

> Documento **genérico e reutilizável**. Consolida as práticas que adotamos
> (stack, arquitetura, deploy, segurança/auth, UX/UI e — quando aplicável —
> multitenancy e API-first), mais boas práticas adicionais de qualidade,
> observabilidade e processo. Use como ponto de partida e **adapte ao contexto**:
> nem todo projeto precisa de tudo.

**Versão:** 1.0 · **Como usar:** copie este arquivo para o novo repositório,
remova as seções não aplicáveis e preencha os pontos marcados `‹decidir›`.

---

## 0. Como ler este blueprint

- **Recomendação padrão** vem primeiro; **alternativas** aparecem quando a escolha
  depende do contexto.
- Seções marcadas **(OPCIONAL — quando solicitado)** só entram se o projeto
  exigir (ex.: Multitenancy, API-first).
- Cada seção fecha com um **checklist** prático.
- Princípio geral: **simplicidade primeiro**; adicionar complexidade só quando o
  problema justificar (evitar over-engineering).

---

## 1. Princípios fundamentais (norteadores)

1. **Server-authoritative** — regra de negócio, autenticação e autorização vivem
   no servidor. O cliente é apresentação; nunca é fronteira de confiança.
2. **Uma API, vários clientes** — web, mobile e integrações consomem a mesma API
   versionada. Sem lógica duplicada por plataforma.
3. **Superfície mínima exposta** — só o gateway/BFF é público; o resto é privado.
   Negar por padrão (allow-list de rotas).
4. **Segurança e privacidade por padrão** — menor privilégio, criptografia em
   trânsito e repouso, segredos fora do código.
5. **Modular primeiro, distribuído depois** — monólito modular bem fatiado;
   extrair serviços só quando a escala justificar.
6. **Contrato como fonte de verdade** — API descrita por OpenAPI/schema; tipos e
   clientes gerados a partir dele.
7. **Tudo versionado e reprodutível** — infraestrutura, schema, dependências e
   configuração em código; ambientes idênticos.
8. **Observabilidade e auditoria desde o dia 1** — logs estruturados, métricas,
   tracing e trilha de auditoria.
9. **Automatizar o repetitivo** — CI/CD, lint, testes, migrations e deploy sem
   passos manuais frágeis.
10. **Decisões registradas** — escolhas relevantes viram **ADRs** (seção 13).

---

## 2. Stack recomendada

Padrão **TypeScript end-to-end** (um só ecossistema de tipos do backend ao front,
máximo reuso e contratação mais simples). Ajuste por contexto.

| Camada | Recomendação padrão | Alternativas / quando |
|--------|---------------------|------------------------|
| Linguagem | **TypeScript** (Node.js LTS) | Go (core de alta performance/isolamento); Elixir (realtime intenso) |
| Backend | **NestJS** (DI, guards/interceptors, modular) | Fastify puro (mais enxuto); Go + chi/echo |
| API | **REST + OpenAPI 3.1** versionada | GraphQL só quando o cliente exigir (mais superfície/authz complexa) |
| ORM/DB toolkit | **Drizzle** (schema em TS, SQL previsível) ou **Prisma** (DX) | Drizzle quando se quer controle fino de SQL |
| Banco | **PostgreSQL** | SQLite (apps pequenos/edge); managed PG quando houver budget |
| Cache/fila | **Redis** | NATS/RabbitMQ para mensageria robusta |
| Object storage | **S3-compatível** (Cloudflare R2, sem egress) | MinIO self-hosted; S3/GCS gerenciado |
| Front web | **React + TypeScript**, mobile-first, PWA | Vue/Svelte conforme time; Next.js se quiser SSR/BFF no front |
| Estilo/UI | **Tailwind** + design system próprio | Component lib (MUI) quando velocidade > customização |
| Mobile nativo | **React Native (Expo)** reusando contratos | Nativo puro (Swift/Kotlin) quando exigir performance/SDKs específicos |
| Auth | **OAuth2/OIDC + MFA**, sessão server-side | Provedor gerenciado (Auth0/Clerk/Keycloak) vs. próprio |

**Checklist**
- [ ] Stack escolhida e justificada (1 linha por camada).
- [ ] Versões LTS fixadas; `engines`/`.nvmrc`/`.tool-versions` no repo.
- [ ] Alternativas relevantes registradas como ADR.

---

## 3. Arquitetura

- **Monólito modular** com fronteiras claras por **domínio** (bounded contexts);
  comunicação entre módulos por interfaces, não por acoplamento direto.
- **Camadas**: apresentação (clientes) → API/aplicação (casos de uso) → domínio
  (regras) → infraestrutura (DB, filas, storage). Dependências apontam para
  dentro.
- **BFF (Backend for Frontend)**: o cliente fala só com o BFF, que mantém sessão
  (cookie httpOnly), injeta contexto (usuário/permissões) e agrega chamadas.
- **Eventos de domínio** para efeitos colaterais desacoplados (ex.: ação dispara
  notificação/integração via fila), com retry/back-off e dead-letter.
- **Contratos versionados** (OpenAPI) gerando clientes e tipos → menos drift.
- **Evolução para serviços** só quando um módulo tiver escala/independência que
  justifique extração.

**Checklist**
- [ ] Domínios mapeados; um diagrama de topologia no repo.
- [ ] Dependências apontam para o domínio (sem regra de negócio na borda).
- [ ] Fluxos assíncronos com retry + dead-letter.

---

## 4. Estrutura de projeto (monorepo)

Monorepo facilita compartilhar tipos/contratos entre back, web e mobile.

```
repo/
├─ apps/
│  ├─ api/            # backend (NestJS)
│  ├─ web/            # front web (React)
│  └─ mobile/         # app nativo (React Native) — quando houver
├─ packages/
│  ├─ shared/         # tipos, schemas (Zod), utils compartilhados
│  ├─ api-client/     # cliente gerado do OpenAPI
│  └─ design-tokens/  # tokens de UI compartilhados (web/mobile)
├─ infra/             # docker-compose, IaC, scripts de deploy
├─ docs/
│  ├─ adr/            # Architecture Decision Records
│  └─ ...
└─ .github/workflows/ # CI/CD
```

- Gerenciador: **pnpm workspaces** (+ Turborepo/Nx se o build crescer).
- Convenção de imports por path alias; sem dependências circulares entre packages.

**Checklist**
- [ ] Monorepo com workspaces; build incremental.
- [ ] `shared`/`api-client`/`design-tokens` isolam o que é reusado.

---

## 5. Deploy e infraestrutura

Padrão pragmático **VPS + Docker Compose** (custo baixo, controle total),
evoluindo para orquestração só quando necessário.

- **Containerização**: Dockerfile multi-stage; imagens enxutas; usuário não-root.
- **Orquestração**: **Docker Compose** para começar (1–N VPS). Kubernetes só com
  escala/SRE que justifique.
- **Ingress único**: reverse proxy (**Caddy/Traefik**) como única porta pública
  (443), TLS automático; opcional CDN/WAF na frente (ex.: Cloudflare).
- **Rede privada**: banco, cache, workers sem portas publicadas no host; firewall
  liberando só 443 (e 22 restrito).
- **Ambientes**: `dev` → `staging` → `prod` idênticos via mesma config
  parametrizada; **paridade dev/prod**.
- **Configuração**: 12-factor — config por variável de ambiente; **segredos em
  cofre/secret manager**, nunca no repo.
- **IaC**: infraestrutura versionada (Compose/Terraform); provisionamento
  reproduzível.
- **CI/CD**: pipeline que builda, testa, escaneia e publica imagem; deploy
  automatizado (rolling/blue-green quando possível) com rollback fácil.
- **Backups + DR**: backup automatizado do banco (dump + PITR quando der), cópia
  off-site cifrada; **testar restauração** periodicamente. Definir **RPO/RTO**.
- **Custo/FinOps**: dimensionar para o uso real; storage com egress baixo;
  observar custo por ambiente.

**Checklist**
- [ ] Build reprodutível em container; imagem escaneada (CVE).
- [ ] Só 443 público; resto privado; firewall ativo.
- [ ] CI/CD com rollback; staging espelha prod.
- [ ] Backup testado; RPO/RTO definidos.

---

## 6. Segurança e autenticação

- **Auth server-side sempre**: cada request valida sessão/credencial + permissão.
  Nada de "protegido só no front".
- **Métodos**: e-mail+senha (hash **Argon2id**), **login social OIDC**
  (Google/etc.), **WebAuthn/Passkeys**.
- **MFA**: TOTP e/ou WebAuthn; **obrigatório** para papéis sensíveis
  (admin/financeiro); códigos de recuperação de uso único.
- **Sessões/tokens**: web em **cookie httpOnly + Secure + SameSite** (token fora
  do JS); mobile/integração em **OAuth2/OIDC** com access token curto + **refresh
  rotativo** (detecção de replay). Revogação imediata em logout/troca de senha.
- **RBAC** com menor privilégio; autorização a nível de objeto quando necessário.
- **Superfície mínima**: único ingress público; serviços internos privados;
  admin/observabilidade só por rede interna/VPN.
- **Segredos**: cofre (Vault/KMS/secret manager), rotação automática, nunca no
  código nem no bundle do cliente.
- **Dados**: TLS 1.2+/1.3 em trânsito; criptografia em repouso; **trilha de
  auditoria imutável** (quem/o quê/quando).
- **Proteções de fluxo**: rate limiting, lockout progressivo, alerta de novo
  device; verificação de e-mail e reset seguro (sem enumeração).
- **Supply chain**: lockfile fixo, **SCA** (deps), **SAST**, **secret scanning** e
  scan de imagem na CI; atualização de dependências com SLA por severidade.
- **SSDLC**: revisão de segurança no PR; testes de autorização automatizados;
  pentest antes do go-live e a cada major.

**Modelo de ameaças (resumo)**

| Ameaça | Mitigação |
|--------|-----------|
| Roubo de token (XSS) | Cookie httpOnly; CSP estrita; tokens fora do JS |
| CSRF | SameSite + token anti-CSRF em mutações |
| Força bruta / stuffing | Rate limit, lockout, MFA |
| Acesso direto a arquivos | Bucket privado + URL assinada curta pós-authz |
| Exposição de serviço interno | Tudo privado; só BFF público; mTLS interno |
| Escalonamento de privilégio | RBAC server-side, menor privilégio, authz por objeto |
| Dependência comprometida | SCA/secret scanning, lockfile, imagens escaneadas |

**Checklist**
- [ ] Auth/authz 100% server-side; MFA para papéis sensíveis.
- [ ] Segredos em cofre; nada sensível no repo/bundle.
- [ ] CI roda SAST/SCA/secret-scan; imagem escaneada.
- [ ] Auditoria imutável ativa.

---

## 7. Multitenancy  *(OPCIONAL — quando solicitado)*

Aplicar quando uma instalação serve **vários clientes/organizações** com
isolamento de dados.

- **Estratégia padrão**: **shared DB + shared schema + `tenant_id` + RLS**
  (Row-Level Security no Postgres). Operação simples e isolamento defensivo no
  banco.
- **Defesa em profundidade**: filtrar por `tenant_id` na aplicação **e** RLS no
  banco — vazamento barrado mesmo se um filtro for esquecido no código.
  - Padrão: a cada request, abrir transação e `SET LOCAL app.current_tenant = …`;
    políticas RLS usam `current_setting('app.current_tenant')`.
  - Usuário de banco da aplicação **sem** `BYPASSRLS`.
- **Tenant em todas as camadas**: auth/sessão, API (resolvido server-side, nunca
  do cliente), cache (chaves prefixadas), storage (prefixo por tenant), logs/
  métricas (label), filas (no payload).
- **Usuário em múltiplos tenants**: vínculo `membership` (user × tenant × papel);
  seleção de tenant ativo no login.
- **Ciclo de vida**: provisionamento + seed padrão; configuração por tenant;
  suspensão/exportação (portabilidade); exclusão auditada.
- **Dados globais vs. do tenant**: catálogos comuns (read-only, compartilhados)
  separados do operacional (por tenant).
- **Alternativas**: schema-por-tenant (mais isolamento, operação mais pesada);
  banco-por-tenant (isolamento máximo, custo alto) — para casos enterprise.

**Checklist**
- [ ] `tenant_id` em toda tabela de domínio + índices compostos.
- [ ] RLS ativo; app sem BYPASSRLS.
- [ ] Teste automatizado: tenant A nunca lê tenant B.
- [ ] Tenant presente em cache/storage/logs/filas.

---

## 8. API-first  *(OPCIONAL — quando solicitado)*

Aplicar quando a API for consumida por **terceiros/outras aplicações** (não só
pelo próprio front).

- **API como produto**: toda funcionalidade nasce na API versionada; OpenAPI é a
  fonte de verdade.
- **Exposta, porém nunca aberta**: todo endpoint exige **credencial + escopo +
  tenant**. Não existe rota de negócio anônima.
- **Dois planos de acesso**:
  - *First-party* (web/mobile próprios) → sessão/OIDC.
  - *Third-party/M2M* (integrações) → **OAuth2 Client Credentials**; **Authorization
    Code + PKCE** quando age em nome de um usuário (consentimento + revogação).
- **Escopos granulares** (`recurso:ação`) + RBAC + (se multitenant) RLS por tenant.
- **Webhooks de saída**: eventos de domínio assinados com **HMAC**, com retries,
  dead-letter e histórico de entregas.
- **DX/contrato**: OpenAPI 3.1; SDKs gerados; **versionamento** por major +
  política de **depreciação** (headers `Deprecation`/`Sunset`); **idempotency-key**
  em escritas; erros padrão **RFC 7807**; paginação por cursor; **sandbox** e
  **portal do desenvolvedor** quando houver parceiros.
- **Segurança de API exposta**: rate limiting/quotas por app e por tenant; WAF;
  auditoria de todo acesso; sem acesso direto a banco/storage.

**Checklist**
- [ ] OpenAPI como fonte de verdade; cliente gerado.
- [ ] M2M via OAuth2 + escopos; nada anônimo.
- [ ] Webhooks assinados (HMAC) com retry/dead-letter.
- [ ] Rate limiting + auditoria de acesso de API.

---

## 9. UX/UI e Design System

- **Mobile-first e responsivo**; PWA quando fizer sentido (offline básico).
- **Design system próprio** sobre a base escolhida (template/lib): **tokens**
  (cor/tipografia/espaçamento) num pacote compartilhável; **componentes base**
  encapsulando a lib (trocável sem reescrever telas).
- **Portabilidade**: tokens reusados no nativo (ex.: NativeWind) para consistência
  web/mobile.
- **Princípios de UX**: navegar **em contexto** (evitar empilhar modais); **toda
  ação tem efeito** (sem botão inerte); **consolidar** (um dashboard por domínio);
  **visão por perfil/login**.
- **Acessibilidade** (contraste, teclado, leitores de tela) e **i18n** desde o
  começo (formatos de data/moeda localizados).
- **White-label leve** por tenant (logo/cor primária) quando multitenant.

**Checklist**
- [ ] Tokens + componentes base isolam a lib visual.
- [ ] Acessibilidade e i18n previstas.
- [ ] Licença da base de UI compatível com o uso (ex.: SaaS pago → licença adequada).

---

## 10. Dados e persistência

- **Migrations versionadas** (idempotentes, reversíveis); nada de alteração manual
  em prod.
- **Schema em código** (ex.: Drizzle/Prisma); revisão de migration no PR.
- **Modelagem**: chaves `uuid`; `timestamptz`; dinheiro em `numeric`/inteiro de
  centavos; `jsonb` com parcimônia (campos genuinamente flexíveis).
- **Integridade**: FKs, constraints e índices pensados (incl. compostos por
  `tenant_id` se multitenant).
- **Soft-delete + auditoria** em entidades sensíveis (nada some sem rastro).
- **Backups/DR**: ver seção 5.

**Checklist**
- [ ] Migrations no repo, aplicadas por CI/CD.
- [ ] Índices e constraints revisados.
- [ ] Estratégia de retenção/descarte definida.

---

## 11. Observabilidade

- **Logs estruturados** (JSON) com `request_id` (+ `tenant_id`/`user_id` quando
  aplicável); **sem dados sensíveis em claro**.
- **Métricas** (Prometheus/OpenTelemetry) + dashboards (Grafana); **alertas** com
  SLO/limiares.
- **Tracing distribuído** nos fluxos críticos.
- **Healthchecks** por serviço; **error tracking** (ex.: Sentry).
- Painéis acessíveis só por rede interna/VPN.

**Checklist**
- [ ] Correlação por `request_id` ponta a ponta.
- [ ] Alertas acionáveis (não ruído).
- [ ] Erros capturados com contexto.

---

## 12. Qualidade e testes

- **Pirâmide de testes**: muitos unitários (domínio) → integração (API/DB) →
  poucos e2e (fluxos-chave).
- **Testes de segurança/autorização** automatizados (e de isolamento de tenant se
  multitenant).
- **Lint + format + type-check** obrigatórios na CI (ESLint, Prettier, `tsc`).
- **Cobertura** com meta pragmática (foco em caminhos críticos, não 100% vaidoso).
- **Definition of Done**: código + testes + docs + revisão + CI verde + sem TODO
  crítico + observabilidade do que foi entregue.
- **Feature flags** para entregar incremental e desligar rápido.

**Checklist**
- [ ] CI bloqueia merge sem lint/types/test verdes.
- [ ] Fluxos críticos cobertos por e2e.
- [ ] DoD acordada pelo time.

---

## 13. Fluxo de trabalho (Git / PR / decisões)

- **Branches**: trunk-based (branches curtas a partir de `main`); `main` sempre
  deployável.
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`…) → changelog e
  versionamento semântico automatizáveis.
- **PRs pequenos e focados**; descrição com contexto; template de PR no repo.
- **Code review** obrigatório; CI verde como gate; revisão de segurança quando
  toca auth/dados.
- **ADRs** (`docs/adr/NNNN-titulo.md`) para decisões arquiteturais relevantes —
  registram contexto, opções e a escolha (template no anexo A).
- **Versionamento**: SemVer; releases tagueadas; changelog mantido.

**Checklist**
- [ ] Conventional commits + template de PR.
- [ ] Review + CI obrigatórios para merge.
- [ ] Decisões relevantes viram ADR.

---

## 14. Privacidade e conformidade

- **Privacy by design**: minimização (coletar só o necessário), finalidade clara,
  retenção/descarte definidos.
- **LGPD/GDPR**: direitos do titular (acesso, correção, portabilidade, exclusão)
  suportados por processo; registro de consentimento p/ comunicações; **DPA** com
  terceiros (provedores, IA, mensageria).
- **Residência de dados**: preferir região adequada à legislação (ex.: Brasil para
  LGPD) — `‹decidir›`.
- **Dados sensíveis**: classificação, criptografia, acesso auditado.

**Checklist**
- [ ] Mapa de dados pessoais + base legal.
- [ ] Processo para direitos do titular.
- [ ] DPAs com terceiros que processam dados.

---

## 15. Performance, acessibilidade e i18n

- **Orçamentos de performance** (ex.: p95 de leitura < 300 ms cacheada; tela densa
  < 1 s); **realtime** com latência-alvo quando aplicável.
- **Acessibilidade** (WCAG): contraste, teclado, ARIA, leitores de tela.
- **i18n/l10n**: textos externalizados; formatos locais; pluralização.
- **Degradação graciosa**: se uma integração externa cair, o núcleo continua.

**Checklist**
- [ ] Orçamentos de performance definidos e medidos.
- [ ] Auditoria de acessibilidade no fluxo principal.
- [ ] i18n preparada mesmo que comece num idioma.

---

## 16. Checklist de bootstrap de um novo projeto

Ordem sugerida para tirar do zero:

1. [ ] Definir domínio/escopo e **personas**; cortar o que não é fase 1.
2. [ ] Escolher stack (seção 2) e registrar ADRs das decisões-chave.
3. [ ] Criar **monorepo** (seção 4) com workspaces e CI básica.
4. [ ] Subir **infra local** (Docker Compose: DB, cache, storage) e `.env.example`.
5. [ ] Implementar **auth + RBAC server-side** (seção 6); MFA para admin.
6. [ ] *(se multitenant)* Ativar `tenant_id` + **RLS** e teste de isolamento.
7. [ ] Definir **contrato OpenAPI** e gerar cliente/tipos.
8. [ ] Montar **design system** (tokens + componentes base) e shell de navegação.
9. [ ] Pipeline **CI/CD** (lint, types, test, SAST/SCA/secret-scan, build, deploy).
10. [ ] **Observabilidade** (logs/métricas/erros) e **backups** testados.
11. [ ] *(se API-first)* Plano de acesso M2M (OAuth2 + escopos) e webhooks.
12. [ ] Documentar: README, ADRs, runbook de deploy/rollback.

---

## Anexo A — Template de ADR

```markdown
# ADR NNNN — <título da decisão>

- Status: proposto | aceito | substituído por ADR-XXXX
- Data: AAAA-MM-DD

## Contexto
<problema, forças, restrições>

## Opções consideradas
1. <opção A> — prós/contras
2. <opção B> — prós/contras

## Decisão
<o que foi escolhido e por quê>

## Consequências
<impactos positivos/negativos, dívidas assumidas, follow-ups>
```

---

## Anexo B — Resumo "o que sempre fazer"

- Auth/authz **no servidor**; cliente é apresentação.
- Só **um ingress público**; resto privado; **segredos em cofre**.
- **Contrato versionado** (OpenAPI) gerando tipos/cliente.
- **Migrations versionadas**; **backup testado**.
- **CI** com lint/types/test/SAST/SCA/secret-scan antes do merge.
- **Logs/métricas/erros** e **auditoria** desde o dia 1.
- **ADR** para decisão relevante; **conventional commits**; PRs pequenos.
- Multitenant → `tenant_id` + **RLS** + teste de isolamento.
- API para terceiros → **exposta, nunca aberta** (credencial + escopo + tenant).