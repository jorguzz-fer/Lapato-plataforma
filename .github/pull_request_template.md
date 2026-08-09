## Contexto

<!-- Que problema isto resolve? Qual módulo do LAPATO é afetado? -->

## O que muda

<!-- Resumo das alterações. Cite o módulo oficial (M01–M26) quando aplicável. -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` e `pnpm test` verdes
- [ ] Tabelas de domínio novas nascem com `tenant_id` e RLS (ADR 0002)
- [ ] Nenhum módulo chama outro diretamente — a integração é por evento
- [ ] Decisão arquitetural relevante virou ADR em `docs/adr/`
- [ ] Sem segredo, credencial ou dado pessoal real no diff
