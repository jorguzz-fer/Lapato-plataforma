# ADR 0002 — Multitenancy com `tenant_id` + Row-Level Security

- Status: aceito
- Data: 2026-08-09

## Contexto

O LAPATO será um produto SaaS que atende várias instituições (laboratórios privados,
hospitais veterinários, universidades, laboratórios públicos, redes de laboratórios).
Cada instituição tem suas próprias unidades, usuários, clientes, casos e acervo.

Vazamento de dados entre instituições é o pior incidente possível para este produto: os
casos contêm diagnósticos, dados de clientes concorrentes entre si e material pericial.

A `0 - Introdução.docx` §12 e o `MÓDULO 01` §7 exigem, além disso, hierarquia interna
**instituição → unidade/filial → setor → local físico**, com herança de configuração.

## Opções consideradas

1. **Shared DB + shared schema + `tenant_id` + RLS** — uma base, uma tabela por entidade,
   isolamento aplicado pelo banco. Operação simples, backup único, migrations únicas.
2. **Schema por tenant** — isolamento maior, mas migrations e conexões multiplicam por
   instituição; consultas administrativas cruzadas ficam difíceis.
3. **Banco por tenant** — isolamento máximo, custo e operação altos; inviável para começar.
4. **Só filtro na aplicação, sem RLS** — mais simples de escrever.
   Contra: um `where` esquecido em qualquer um dos 26 módulos vaza dados entre instituições.

## Decisão

Opção 1, com **defesa em profundidade**, conforme Blueprint §7.

- Toda tabela de domínio tem `tenant_id NOT NULL` e índice composto começando por ele.
- A aplicação **também** filtra por `tenant_id`. RLS é a segunda barreira, não a única.
- A cada request o BFF abre transação e executa
  `SET LOCAL app.current_tenant = '<uuid>'`. As políticas RLS usam
  `current_setting('app.current_tenant')`.
- O usuário de banco da aplicação (`lapato_app`) **não tem `BYPASSRLS`**. Migrations rodam
  com um usuário separado (`lapato_owner`).
- O `tenant_id` é resolvido **no servidor**, a partir da sessão. Nunca é aceito do cliente.
- `tenant_id` presente também em chaves de cache, prefixo de storage, labels de log e
  payload de fila.
- Hierarquia interna (unidade → setor → local) é modelada **dentro** do tenant, não como
  tenant. Uma instituição com cinco filiais é um tenant só.

## Consequências

- Teste automatizado obrigatório: tenant A não lê tenant B, inclusive com o filtro de
  aplicação desabilitado, para provar que a RLS sozinha barra o vazamento. Sem esse teste
  verde, não há merge.
- Toda migration que cria tabela de domínio precisa criar também a policy. Um teste de
  schema verifica que não existe tabela de domínio sem RLS habilitada.
- Consultas administrativas cross-tenant (suporte, métricas agregadas) exigem um caminho
  explícito e auditado, não podem usar a conexão normal da aplicação.
