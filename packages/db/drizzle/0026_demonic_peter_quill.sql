CREATE TABLE "raca" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"especie_id" uuid,
	"nome" text NOT NULL,
	"usos" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_raca_especie_nome" UNIQUE("tenant_id","especie_id","nome")
);
--> statement-breakpoint
ALTER TABLE "recipiente" ADD COLUMN "laminas_declaradas" integer;--> statement-breakpoint
ALTER TABLE "recipiente" ADD COLUMN "laminas_recebidas" integer;--> statement-breakpoint
CREATE INDEX "idx_raca_especie" ON "raca" USING btree ("tenant_id","especie_id");--> statement-breakpoint
-- =============================================================================
-- Quinta revisao, segunda parte: cadastro de histo e cito.
--
-- Duas entregas de dados para quem ja esta rodando:
--  1. "Nao fixada" entra na tabela de fixadores - e o padrao da citologia, em
--     que a lamina chega seca da coleta.
--  2. A lista de racas nasce do que o laboratorio ja digitou. O documento pede
--     um dropdown "abastecido com as racas pelo uso"; as racas dos pacientes
--     que ja existem SAO esse uso, e `usos` ja chega contado - a lista util
--     aparece no primeiro dia, e nao daqui a tres meses.
--
-- NO FORCE/FORCE em volta: `termo`, `tabela_mestre` e `paciente` estao sob
-- FORCE ROW LEVEL SECURITY, que vale ate para o owner; sem `app.current_tenant`
-- o SELECT nao veria linha nenhuma e o INSERT nao faria nada (licao das
-- migrations 0008 e 0014). `raca` ainda nao tem policy: ela e criada pelo
-- rls.ts depois desta migration.
-- =============================================================================

ALTER TABLE "tabela_mestre" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "termo" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "paciente" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

INSERT INTO "termo" ("tenant_id", "tabela_id", "valor", "codigo", "ordem")
SELECT tm."tenant_id", tm."id", 'Não fixada', 'NAO_FIXADA', 90
FROM "tabela_mestre" tm
WHERE tm."chave" = 'fixador'
  AND NOT EXISTS (
    SELECT 1 FROM "termo" t
    WHERE t."tabela_id" = tm."id" AND lower(t."valor") = lower('Não fixada')
  );
--> statement-breakpoint

-- As racas que o laboratorio ja digitou, por especie, com o uso ja contado.
INSERT INTO "raca" ("tenant_id", "especie_id", "nome", "usos")
-- min() escolhe UMA grafia entre as variacoes do mesmo nome ("SRD", "srd ").
-- Nao e a mais frequente, e a primeira em ordem alfabetica; o que importa e a
-- lista nao ter a mesma raca duas vezes. Quem quiser outra grafia edita.
SELECT p."tenant_id", p."especie_id", min(btrim(p."raca")) AS nome, count(*)::int AS usos
FROM "paciente" p
WHERE p."raca" IS NOT NULL
  AND btrim(p."raca") <> ''
GROUP BY p."tenant_id", p."especie_id", lower(btrim(p."raca"))
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Mais o mesmo ponto de partida que a instituicao nova recebe pelo
-- base-institucional, para a lista nao abrir vazia no primeiro dia. `usos`
-- entra pequeno de proposito: basta um punhado de cadastros reais para o que o
-- laboratorio de fato ve passar na frente. Especies sem lista aqui (Bovina,
-- Ave, Replil, Roedor) aprendem do zero.
INSERT INTO "raca" ("tenant_id", "especie_id", "nome", "usos")
SELECT e."tenant_id", e."id", v."nome", v."usos"
FROM "termo" e
JOIN "tabela_mestre" tm ON tm."id" = e."tabela_id" AND tm."chave" = 'especie'
JOIN (VALUES
  ('Canina', 'SRD', 15), ('Canina', 'Labrador Retriever', 14),
  ('Canina', 'Golden Retriever', 13), ('Canina', 'Shih Tzu', 12),
  ('Canina', 'Poodle', 11), ('Canina', 'Yorkshire Terrier', 10),
  ('Canina', 'Pinscher', 9), ('Canina', 'Bulldog Francês', 8),
  ('Canina', 'Pastor Alemão', 7), ('Canina', 'Rottweiler', 6),
  ('Canina', 'Dachshund', 5), ('Canina', 'Border Collie', 4),
  ('Canina', 'Pug', 3), ('Canina', 'Lhasa Apso', 2), ('Canina', 'Maltês', 1),
  ('Felina', 'SRD', 8), ('Felina', 'Persa', 7), ('Felina', 'Siamês', 6),
  ('Felina', 'Maine Coon', 5), ('Felina', 'Angorá', 4), ('Felina', 'Bengal', 3),
  ('Felina', 'Ragdoll', 2), ('Felina', 'Sphynx', 1),
  ('Equina', 'Mangalarga Marchador', 5), ('Equina', 'Quarto de Milha', 4),
  ('Equina', 'Puro Sangue Inglês', 3), ('Equina', 'Crioulo', 2),
  ('Equina', 'Árabe', 1)
) AS v("especie", "nome", "usos") ON v."especie" = e."valor"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- E cada paciente passa a apontar para a linha da lista, nao so para o texto.
UPDATE "paciente" p
SET "raca_id" = r."id"
FROM "raca" r
WHERE p."raca_id" IS NULL
  AND p."raca" IS NOT NULL
  AND r."tenant_id" = p."tenant_id"
  AND lower(r."nome") = lower(btrim(p."raca"))
  AND r."especie_id" IS NOT DISTINCT FROM p."especie_id";
--> statement-breakpoint

ALTER TABLE "paciente" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "termo" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tabela_mestre" FORCE ROW LEVEL SECURITY;
