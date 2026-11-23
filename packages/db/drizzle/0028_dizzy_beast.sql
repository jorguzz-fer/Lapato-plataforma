ALTER TABLE "cadaver" ADD COLUMN "origem_responsavel_documento" text;--> statement-breakpoint
ALTER TABLE "cadaver" ADD COLUMN "reconhecimento" text;--> statement-breakpoint
-- =============================================================================
-- Quinta revisao, quarta parte: necropsia e controle de cadaveres.
--
-- O armazenamento de cadaveres nasce pronto: Camara fria com a grade 3x3 do
-- desenho (1A a 3C) e Freezer com 2x3, cada bandeja como `local_fisico` filho
-- da camara - a tabela ja e hierarquica, entao a grade e dado, nao coluna.
--
-- Por que semear: um corpo recebido sem lugar no mapa e exatamente o que o M15
-- existe para impedir, e abrir o sistema com zero posicoes obriga a inventа-las
-- na primeira entrada - a pior hora para inventar. O laboratorio renomeia,
-- acrescenta e inativa bandejas na Administracao como qualquer outro local.
--
-- `capacidade = 1` por bandeja nao e tranca: desde esta revisao o sistema
-- aceita mais de um corpo na mesma lacuna ("e possivel acondiciona-los juntos")
-- e usa a capacidade so para avisar que passou da conta.
--
-- NO FORCE/FORCE: `unidade`, `setor` e `local_fisico` estao sob FORCE ROW LEVEL
-- SECURITY, que vale ate para o owner; sem `app.current_tenant` o SELECT nao
-- veria linha nenhuma e o INSERT nao faria nada (licao das migrations 0008 e
-- 0014).
-- =============================================================================

ALTER TABLE "unidade" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "setor" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "local_fisico" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

INSERT INTO "local_fisico"
  ("tenant_id", "unidade_id", "setor_id", "nome", "codigo", "categoria",
   "condicao_ambiental", "capacidade")
SELECT
  u."tenant_id", u."id",
  (SELECT s."id" FROM "setor" s
    WHERE s."tenant_id" = u."tenant_id" AND s."tipo" = 'macroscopia' LIMIT 1),
  v."nome", v."codigo", 'armazenamento_cadaver', v."condicao", v."capacidade"
FROM "unidade" u
CROSS JOIN (VALUES
  ('Câmara fria', 'CF', 'refrigerado', 9),
  ('Freezer', 'FZ', 'congelado', 6)
) AS v("nome", "codigo", "condicao", "capacidade")
WHERE u."tipo" = 'sede'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- As bandejas, penduradas na camara recem-criada.
INSERT INTO "local_fisico"
  ("tenant_id", "unidade_id", "setor_id", "pai_id", "nome", "codigo", "categoria",
   "condicao_ambiental", "capacidade")
SELECT
  c."tenant_id", c."unidade_id", c."setor_id", c."id",
  c."nome" || ' ' || v."pos", c."codigo" || v."pos", 'bandeja_cadaver',
  c."condicao_ambiental", 1
FROM "local_fisico" c
CROSS JOIN (VALUES
  ('1A'), ('1B'), ('1C'), ('2A'), ('2B'), ('2C'), ('3A'), ('3B'), ('3C')
) AS v("pos")
WHERE c."categoria" = 'armazenamento_cadaver'
  AND c."codigo" = 'CF'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "local_fisico"
  ("tenant_id", "unidade_id", "setor_id", "pai_id", "nome", "codigo", "categoria",
   "condicao_ambiental", "capacidade")
SELECT
  c."tenant_id", c."unidade_id", c."setor_id", c."id",
  c."nome" || ' ' || v."pos", c."codigo" || v."pos", 'bandeja_cadaver',
  c."condicao_ambiental", 1
FROM "local_fisico" c
CROSS JOIN (VALUES
  ('1A'), ('1B'), ('1C'), ('2A'), ('2B'), ('2C')
) AS v("pos")
WHERE c."categoria" = 'armazenamento_cadaver'
  AND c."codigo" = 'FZ'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

ALTER TABLE "local_fisico" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "setor" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "unidade" FORCE ROW LEVEL SECURITY;
