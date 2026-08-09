# ADR 0003 — Drizzle como toolkit de banco

- Status: aceito
- Data: 2026-08-09

## Contexto

O modelo do LAPATO é grande e relacional: caso, amostra, recipiente, cassete, bloco,
lâmina, laudo versionado, eventos append-only, além de RLS em todas as tabelas de domínio.

Precisamos de schema em código (Blueprint §10), migrations versionadas e reversíveis, e
controle fino sobre o SQL — especialmente para políticas RLS, índices compostos por
`tenant_id` e consultas de fila/dashboard que precisam ser previsíveis.

## Opções consideradas

1. **Drizzle** — schema em TypeScript, SQL previsível e próximo do que é escrito,
   migrations em SQL puro que podemos editar para incluir policies.
   Contra: ergonomia de relações menos açucarada que a do Prisma.
2. **Prisma** — melhor DX para CRUD e relações.
   Contras: camada de query própria, SQL gerado menos previsível, e RLS exige contornos
   (o pool de conexões precisa de `SET LOCAL` por transação, que fica mais desconfortável).
3. **SQL puro com um driver** — controle total.
   Contra: sem tipos derivados do schema, muito código repetitivo em 26 módulos.

## Decisão

**Drizzle**, conforme pedido explícito e alinhado à recomendação padrão do Blueprint §2.

- Schema em `packages/db/src/schema/`, um arquivo por área de domínio.
- Migrations SQL versionadas em `packages/db/drizzle/`, aplicadas por CI/CD.
- As políticas RLS vivem em migration SQL própria, revisada como código.
- Tipos das entidades derivados do schema e reexportados para o resto do monorepo.

## Consequências

- Alterações de schema exigem gerar a migration e revisá-la no PR — inclusive a policy RLS
  correspondente. Isso é desejável: migration silenciosa em prod é justamente o que o
  Blueprint §10 proíbe.
- Consultas mais complexas (filas, indicadores) serão escritas próximas de SQL, o que
  facilita otimizar depois com `EXPLAIN`.
