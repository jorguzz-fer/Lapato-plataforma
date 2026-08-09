# ADR 0001 — Stack e arquitetura base

- Status: aceito
- Data: 2026-08-09

## Contexto

O LAPATO é uma plataforma de gestão anatomopatológica veterinária com 26 módulos previstos,
centrada no Caso Anatomopatológico. As DIRETRIZES DE INTEGRAÇÃO impõem fonte única de
verdade, módulo proprietário por dado, integração orientada a eventos e dossiê único por
caso. O `Engineering Blueprint.md` define a stack recomendada da casa.

Restrições relevantes: equipe pequena, necessidade de evoluir por módulos ao longo de anos,
requisito futuro de aplicativo móvel e de integrações com clínicas e equipamentos.

## Opções consideradas

1. **TypeScript end-to-end com monólito modular (NestJS + React)** — um só ecossistema de
   tipos do banco ao front; fronteiras por bounded context dentro de um processo.
   Contras: um único deploy para tudo no início.
2. **Microsserviços desde o início, um por grupo funcional** — isolamento forte.
   Contras: 26 módulos viram dezenas de serviços; operação, tracing e transações
   distribuídas custam caro antes de existir escala que justifique.
3. **Backend em Go + front em React** — performance no núcleo.
   Contras: dois ecossistemas de tipos, contratos duplicados, contratação mais difícil.

## Decisão

Opção 1: **monólito modular em TypeScript**, seguindo o Blueprint §2 e §3.

- Backend **NestJS** (DI, guards, interceptors, módulos por bounded context).
- **REST + OpenAPI 3.1** versionada em `/api/v1`, contrato como fonte de verdade.
- **PostgreSQL 16**, **Redis** (BullMQ) e **storage S3-compatível**.
- Front **React + TypeScript + Vite** com **Tailwind**.
- **Monorepo pnpm + Turborepo**, com `packages/shared`, `packages/api-client` e
  `packages/design-tokens` isolando o que é reusado.
- **BFF**: o cliente fala só com a API, que mantém sessão em cookie httpOnly e injeta
  contexto de usuário, tenant e permissões.
- Efeitos colaterais entre módulos por **eventos de domínio** com retry, back-off e
  dead-letter, nunca por chamada direta entre módulos.

## Consequências

- Um único artefato de deploy no início; simplifica operação e transações.
- Fronteiras precisam ser respeitadas por disciplina e revisão de PR, já que o compilador
  não impede import cruzado entre módulos. Mitigação: cada módulo expõe uma interface
  pública em `index.ts` e a regra é revisada no code review.
- Extrair um módulo para serviço próprio no futuro exige que ele já converse por eventos —
  por isso o event bus entra desde o dia 1, mesmo rodando in-process.
