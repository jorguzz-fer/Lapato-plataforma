CREATE TABLE "subtipo_solicitacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tipo_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_subtipo_solicitacao" UNIQUE("tenant_id","tipo_id","nome")
);
--> statement-breakpoint
CREATE TABLE "tipo_pendencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"chave" text NOT NULL,
	"nome" text NOT NULL,
	"bloqueia_padrao" "nivel_bloqueio" DEFAULT 'nao' NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_tipo_pendencia_chave" UNIQUE("tenant_id","chave")
);
--> statement-breakpoint
ALTER TABLE "etapa_tipo_solicitacao" ADD COLUMN "automatica" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pendencia" ADD COLUMN "tipo_id" uuid;--> statement-breakpoint
ALTER TABLE "solicitacao" ADD COLUMN "subtipo_id" uuid;--> statement-breakpoint
ALTER TABLE "solicitacao" ADD COLUMN "subtipo" text;--> statement-breakpoint
ALTER TABLE "tipo_solicitacao" ADD COLUMN "perfis_permitidos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tipo_solicitacao" ADD COLUMN "perfis_destino" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subtipo_solicitacao" ADD CONSTRAINT "subtipo_solicitacao_tipo_id_tipo_solicitacao_id_fk" FOREIGN KEY ("tipo_id") REFERENCES "public"."tipo_solicitacao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_subtipo_tipo" ON "subtipo_solicitacao" USING btree ("tenant_id","tipo_id");--> statement-breakpoint
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_tipo_id_tipo_pendencia_id_fk" FOREIGN KEY ("tipo_id") REFERENCES "public"."tipo_pendencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao" ADD CONSTRAINT "solicitacao_subtipo_id_subtipo_solicitacao_id_fk" FOREIGN KEY ("subtipo_id") REFERENCES "public"."subtipo_solicitacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- =============================================================================
-- Quinta revisao (documento do Dr. Hugo): o catalogo que o laboratorio ja usa
-- precisa nascer preenchido. Instituicao nova recebe tudo isto pelo
-- base-institucional; as que ja existem recebem aqui.
--
-- Idempotente de ponta a ponta (ON CONFLICT DO NOTHING / WHERE NOT EXISTS):
-- esta migration pode rodar em banco que ja tem parte dos dados.
--
-- FORCE ROW LEVEL SECURITY: as duas tabelas novas ainda nao tem policy (ela e
-- criada pelo rls.ts depois), entao INSERT nelas passa. Para os UPDATE em
-- tipo_solicitacao e etapa_tipo_solicitacao o FORCE vale ate para o owner e
-- sem `app.current_tenant` nenhuma linha seria atingida - por isso o
-- NO FORCE/FORCE em volta (mesma licao das migrations 0008 e 0014).
-- =============================================================================

-- Tipos de pendencia: "Cadastral, Clinica, Identificacao de margens, Execucao
-- tecnica, Autorizacao, Macroscopia, Outra - essas opcoes devem ser editaveis".
INSERT INTO "tipo_pendencia" ("tenant_id", "chave", "nome", "bloqueia_padrao", "ordem")
SELECT t."id", v."chave", v."nome", v."bloqueia"::"nivel_bloqueio", v."ordem"
FROM "tenant" t
CROSS JOIN (VALUES
  ('cadastral', 'Cadastral', 'nao', 0),
  ('clinica', 'Clínica', 'nao', 1),
  ('identificacao_margens', 'Identificação de margens', 'parcial', 2),
  ('execucao_tecnica', 'Execução técnica', 'nao', 3),
  ('autorizacao', 'Autorização', 'total', 4),
  ('macroscopia', 'Macroscopia', 'nao', 5),
  ('outra', 'Outra', 'nao', 6)
) AS v("chave", "nome", "bloqueia", "ordem")
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Tipos de solicitacao que o documento acrescentou ao formulario.
ALTER TABLE "tipo_solicitacao" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "etapa_tipo_solicitacao" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Corantes da coloracao especial (lista do formulario do patologista).
INSERT INTO "subtipo_solicitacao" ("tenant_id", "tipo_id", "nome", "ordem")
SELECT ts."tenant_id", ts."id", v."nome", v."ordem"
FROM "tipo_solicitacao" ts
CROSS JOIN (VALUES
  ('PAS', 0), ('Ziehl-Neelsen', 1), ('Gram', 2), ('Grocott', 3), ('Faraco', 4),
  ('Tricrômico de Masson', 5), ('Azul de Toluidina', 6), ('Rodanina', 7),
  ('Fontana-Masson', 8), ('Perls', 9), ('Novo HE', 10), ('Outra', 11)
) AS v("nome", "ordem")
WHERE ts."chave" = 'coloracao_especial'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "tipo_solicitacao" ("tenant_id", "chave", "nome", "descricao", "setor_padrao", "ordem")
SELECT t."id", v."chave", v."nome", v."descricao", v."setor", v."ordem"
FROM "tenant" t
CROSS JOIN (VALUES
  ('aprofundar_corte', 'Aprofundar corte', 'Mesmo caminho da coloração: bloco, processamento e volta.', 'histotecnica', 20),
  ('problema_tecnico', 'Problema técnico', 'Lâmina com dobra, bolha, corte espesso: refazer.', 'histotecnica', 21),
  ('niveis_adicionais', 'Níveis adicionais', NULL, 'histotecnica', 22),
  ('reamostragem', 'Reamostragem', 'O material não representa a lesão: é preciso nova coleta.', 'recepcao', 23),
  ('revisao_interna', 'Revisão interna', 'Segunda leitura por outro patologista da casa.', 'microscopia', 24),
  ('informacao_clinica', 'Informação clínica', 'Falta dado do paciente para interpretar o caso.', 'recepcao', 25)
) AS v("chave", "nome", "descricao", "setor", "ordem")
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Fluxo dos tipos de bancada, exatamente como esta escrito no documento:
-- "Solicitacao -> Separacao do bloco -> Processamento -> Envio ao Patologista".
INSERT INTO "etapa_tipo_solicitacao" ("tenant_id", "tipo_id", "ordem", "rotulo", "setor", "automatica")
SELECT ts."tenant_id", ts."id", v."ordem", v."rotulo", v."setor", v."automatica"
FROM "tipo_solicitacao" ts
CROSS JOIN (VALUES
  (1, 'Solicitação', 'microscopia', true),
  (2, 'Separação do bloco', 'histotecnica', false),
  (3, 'Processamento', 'histotecnica', false),
  (4, 'Envio ao patologista', 'microscopia', false)
) AS v("ordem", "rotulo", "setor", "automatica")
WHERE ts."chave" IN ('aprofundar_corte', 'problema_tecnico', 'niveis_adicionais')
  AND NOT EXISTS (
    SELECT 1 FROM "etapa_tipo_solicitacao" e
    WHERE e."tenant_id" = ts."tenant_id" AND e."tipo_id" = ts."id"
  );
--> statement-breakpoint

INSERT INTO "etapa_tipo_solicitacao" ("tenant_id", "tipo_id", "ordem", "rotulo", "setor", "automatica")
SELECT ts."tenant_id", ts."id", v."ordem", v."rotulo", v."setor", v."automatica"
FROM "tipo_solicitacao" ts
CROSS JOIN (VALUES
  (1, 'Solicitação', 'microscopia', true),
  (2, 'Cliente avisado', 'recepcao', false),
  (3, 'Novo material recebido', 'recepcao', false),
  (4, 'Envio ao patologista', 'microscopia', false)
) AS v("ordem", "rotulo", "setor", "automatica")
WHERE ts."chave" = 'reamostragem'
  AND NOT EXISTS (
    SELECT 1 FROM "etapa_tipo_solicitacao" e
    WHERE e."tenant_id" = ts."tenant_id" AND e."tipo_id" = ts."id"
  );
--> statement-breakpoint

INSERT INTO "etapa_tipo_solicitacao" ("tenant_id", "tipo_id", "ordem", "rotulo", "setor", "automatica")
SELECT ts."tenant_id", ts."id", v."ordem", v."rotulo", v."setor", v."automatica"
FROM "tipo_solicitacao" ts
CROSS JOIN (VALUES
  (1, 'Solicitação', 'microscopia', true),
  (2, 'Lâminas separadas', 'histotecnica', false),
  (3, 'Parecer registrado', 'microscopia', false)
) AS v("ordem", "rotulo", "setor", "automatica")
WHERE ts."chave" = 'revisao_interna'
  AND NOT EXISTS (
    SELECT 1 FROM "etapa_tipo_solicitacao" e
    WHERE e."tenant_id" = ts."tenant_id" AND e."tipo_id" = ts."id"
  );
--> statement-breakpoint

-- Os tipos de bancada que ja existiam ganham o fluxo do documento. O que
-- estava lá ("Recebida pelo laboratorio" etc.) sai: etapa_tipo_solicitacao e
-- CONFIGURACAO; o historico de cada pedido mora em andamento_solicitacao, com
-- o rotulo congelado, e nao e tocado aqui.
DELETE FROM "etapa_tipo_solicitacao" e
USING "tipo_solicitacao" ts
WHERE e."tipo_id" = ts."id"
  AND ts."chave" IN ('coloracao_especial', 'recorte', 'imuno_histoquimica')
  AND NOT EXISTS (
    SELECT 1 FROM "etapa_tipo_solicitacao" x
    WHERE x."tipo_id" = ts."id" AND x."automatica" = true
  );
--> statement-breakpoint

INSERT INTO "etapa_tipo_solicitacao" ("tenant_id", "tipo_id", "ordem", "rotulo", "setor", "automatica")
SELECT ts."tenant_id", ts."id", v."ordem", v."rotulo", v."setor", v."automatica"
FROM "tipo_solicitacao" ts
CROSS JOIN (VALUES
  (1, 'Solicitação', 'microscopia', true),
  (2, 'Separação do bloco', 'histotecnica', false),
  (3, 'Processamento', 'histotecnica', false),
  (4, 'Envio ao patologista', 'microscopia', false)
) AS v("ordem", "rotulo", "setor", "automatica")
WHERE ts."chave" = 'coloracao_especial'
  AND NOT EXISTS (
    SELECT 1 FROM "etapa_tipo_solicitacao" e
    WHERE e."tenant_id" = ts."tenant_id" AND e."tipo_id" = ts."id"
  );
--> statement-breakpoint

-- IHQ: mesmo inicio, e o caminho do laboratorio externo no meio.
INSERT INTO "etapa_tipo_solicitacao" ("tenant_id", "tipo_id", "ordem", "rotulo", "setor", "automatica")
SELECT ts."tenant_id", ts."id", v."ordem", v."rotulo", v."setor", v."automatica"
FROM "tipo_solicitacao" ts
CROSS JOIN (VALUES
  (1, 'Solicitação', 'microscopia', true),
  (2, 'Separação do bloco', 'histotecnica', false),
  (3, 'Enviado ao laboratório de IHQ', 'histotecnica', false),
  (4, 'Resultado recebido', 'histotecnica', false),
  (5, 'Envio ao patologista', 'microscopia', false)
) AS v("ordem", "rotulo", "setor", "automatica")
WHERE ts."chave" = 'imuno_histoquimica'
  AND NOT EXISTS (
    SELECT 1 FROM "etapa_tipo_solicitacao" e
    WHERE e."tenant_id" = ts."tenant_id" AND e."tipo_id" = ts."id"
  );
--> statement-breakpoint

-- Recorte: a segunda etapa e "Clivagem", nao "Separacao do bloco".
INSERT INTO "etapa_tipo_solicitacao" ("tenant_id", "tipo_id", "ordem", "rotulo", "setor", "automatica")
SELECT ts."tenant_id", ts."id", v."ordem", v."rotulo", v."setor", v."automatica"
FROM "tipo_solicitacao" ts
CROSS JOIN (VALUES
  (1, 'Solicitação', 'microscopia', true),
  (2, 'Clivagem', 'macroscopia', false),
  (3, 'Processamento', 'histotecnica', false),
  (4, 'Envio ao patologista', 'microscopia', false)
) AS v("ordem", "rotulo", "setor", "automatica")
WHERE ts."chave" = 'recorte'
  AND NOT EXISTS (
    SELECT 1 FROM "etapa_tipo_solicitacao" e
    WHERE e."tenant_id" = ts."tenant_id" AND e."tipo_id" = ts."id"
  );
--> statement-breakpoint

-- A IHQ e os demais tipos que ja tinham fluxo so ganham a etapa automatica:
-- a primeira etapa de qualquer fluxo e o ato de pedir.
UPDATE "etapa_tipo_solicitacao" e
SET "automatica" = true
FROM "tipo_solicitacao" ts
WHERE e."tipo_id" = ts."id"
  AND e."ordem" = 1
  AND e."rotulo" = 'Solicitação'
  AND e."automatica" = false;
--> statement-breakpoint

-- Os tipos do Portal (devolucao de bloco, segunda opiniao) nao entram no
-- UPDATE acima: a primeira etapa deles e "Recebida pelo laboratorio", que e
-- um ato do laboratorio e segue precisando de clique.
ALTER TABLE "etapa_tipo_solicitacao" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tipo_solicitacao" FORCE ROW LEVEL SECURITY;
