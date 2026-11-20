CREATE TABLE "andamento_solicitacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"solicitacao_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	"rotulo" text NOT NULL,
	"observacao" text,
	"registrado_por_id" uuid,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_andamento_ordem" UNIQUE("tenant_id","solicitacao_id","ordem")
);
--> statement-breakpoint
CREATE TABLE "etapa_tipo_solicitacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tipo_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	"rotulo" text NOT NULL,
	"setor" text,
	"texto_portal" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_etapa_tipo_ordem" UNIQUE("tenant_id","tipo_id","ordem")
);
--> statement-breakpoint
CREATE TABLE "tipo_solicitacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"chave" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"exige_aprovacao" boolean DEFAULT false NOT NULL,
	"visivel_portal" boolean DEFAULT false NOT NULL,
	"setor_padrao" text,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_tipo_solicitacao_chave" UNIQUE("tenant_id","chave")
);
--> statement-breakpoint
ALTER TABLE "solicitacao" ADD COLUMN "tipo_id" uuid;--> statement-breakpoint
ALTER TABLE "solicitacao" ADD COLUMN "etapa_atual" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "andamento_solicitacao" ADD CONSTRAINT "andamento_solicitacao_solicitacao_id_solicitacao_id_fk" FOREIGN KEY ("solicitacao_id") REFERENCES "public"."solicitacao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "andamento_solicitacao" ADD CONSTRAINT "andamento_solicitacao_registrado_por_id_usuario_id_fk" FOREIGN KEY ("registrado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etapa_tipo_solicitacao" ADD CONSTRAINT "etapa_tipo_solicitacao_tipo_id_tipo_solicitacao_id_fk" FOREIGN KEY ("tipo_id") REFERENCES "public"."tipo_solicitacao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_andamento_solicitacao" ON "andamento_solicitacao" USING btree ("tenant_id","solicitacao_id");--> statement-breakpoint
CREATE INDEX "idx_etapa_tipo" ON "etapa_tipo_solicitacao" USING btree ("tenant_id","tipo_id");--> statement-breakpoint
CREATE INDEX "idx_tipo_solicitacao_ordem" ON "tipo_solicitacao" USING btree ("tenant_id","ordem");--> statement-breakpoint
ALTER TABLE "solicitacao" ADD CONSTRAINT "solicitacao_tipo_id_tipo_solicitacao_id_fk" FOREIGN KEY ("tipo_id") REFERENCES "public"."tipo_solicitacao"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
-- Catalogo inicial de tipos de solicitacao para as instituicoes que JA existem.
--
-- `criarBaseInstitucional` semeia isto em tenant novo; sem este bloco, a
-- instituicao que ja esta rodando subiria com a tela de solicitacao vazia e
-- nenhum fluxo configurado. E aditivo e idempotente: ON CONFLICT DO NOTHING
-- respeita o que o laboratorio ja tiver cadastrado ou renomeado.
--
-- As tabelas sao novas, entao ainda nao tem policy de RLS neste ponto da
-- migracao (o CLI aplica RLS depois) - e `tenant` nao tem RLS por desenho.
INSERT INTO "tipo_solicitacao"
  ("tenant_id", "chave", "nome", "descricao", "exige_aprovacao", "visivel_portal", "setor_padrao", "ordem")
SELECT t.id, v.chave, v.nome, v.descricao, v.exige_aprovacao, v.visivel_portal, v.setor_padrao, v.ordem
FROM "tenant" t
CROSS JOIN (VALUES
    ('coloracao_especial', 'Coloração especial', 'PAS, Ziehl-Neelsen, Grocott, Tricrômico, Perls.', false, false, 'histotecnica', 0),
    ('imuno_histoquimica', 'Imuno-histoquímica (IHQ)', 'Custo alto: passa por aprovação antes de ir para a fila.', true, false, 'histotecnica', 1),
    ('recorte', 'Recorte da amostra', 'A amostragem não foi representativa: volta à bancada.', false, false, 'macroscopia', 2),
    ('devolucao_bloco', 'Devolução de bloco', 'Bloco devolvido ao solicitante, em geral para exame complementar externo.', false, true, 'histotecnica', 3),
    ('devolucao_lamina', 'Devolução de lâmina', NULL, false, true, 'histotecnica', 4),
    ('segunda_opiniao', 'Segunda opinião', NULL, false, true, 'microscopia', 5),
    ('copia_laudo', 'Cópia do laudo', NULL, false, true, 'recepcao', 6)
) AS v(chave, nome, descricao, exige_aprovacao, visivel_portal, setor_padrao, ordem)
ON CONFLICT ("tenant_id", "chave") DO NOTHING;--> statement-breakpoint

INSERT INTO "etapa_tipo_solicitacao" ("tenant_id", "tipo_id", "ordem", "rotulo", "setor", "texto_portal")
SELECT ts.tenant_id, ts.id, v.ordem, v.rotulo, v.setor, v.texto_portal
FROM "tipo_solicitacao" ts
JOIN (VALUES
    ('coloracao_especial', 1, 'Recebida pelo laboratório', 'histotecnica', NULL::text),
    ('coloracao_especial', 2, 'Bloco separado', 'histotecnica', NULL),
    ('coloracao_especial', 3, 'Enviado ao processamento', 'histotecnica', NULL),
    ('coloracao_especial', 4, 'Lâmina corada', 'histotecnica', NULL),
    ('coloracao_especial', 5, 'Enviada ao patologista', 'microscopia', NULL),
    ('imuno_histoquimica', 1, 'Recebida pelo laboratório', 'histotecnica', NULL),
    ('imuno_histoquimica', 2, 'Bloco separado', 'histotecnica', NULL),
    ('imuno_histoquimica', 3, 'Enviado ao laboratório de IHQ', 'histotecnica', NULL),
    ('imuno_histoquimica', 4, 'Resultado recebido', 'histotecnica', NULL),
    ('imuno_histoquimica', 5, 'Enviado ao patologista', 'microscopia', NULL),
    ('recorte', 1, 'Recebida pela macroscopia', 'macroscopia', NULL),
    ('recorte', 2, 'Material localizado', 'macroscopia', NULL),
    ('recorte', 3, 'Recortado e incluído', 'macroscopia', NULL),
    ('recorte', 4, 'Enviado ao processamento', 'histotecnica', NULL),
    ('recorte', 5, 'Lâmina enviada ao patologista', 'microscopia', NULL),
    ('devolucao_bloco', 1, 'Recebida pelo laboratório', 'histotecnica', 'Solicitação recebida'),
    ('devolucao_bloco', 2, 'Bloco solicitado ao arquivo', 'histotecnica', 'Material sendo localizado'),
    ('devolucao_bloco', 3, 'Bloco recebido de volta', 'histotecnica', 'Material localizado'),
    ('devolucao_bloco', 4, 'Separado para envio', 'recepcao', 'Material separado para envio'),
    ('devolucao_bloco', 5, 'Entregue ao solicitante', 'recepcao', 'Material entregue'),
    ('devolucao_lamina', 1, 'Recebida pelo laboratório', 'histotecnica', 'Solicitação recebida'),
    ('devolucao_lamina', 2, 'Lâmina localizada', 'histotecnica', 'Material sendo localizado'),
    ('devolucao_lamina', 3, 'Separada para envio', 'recepcao', 'Material separado para envio'),
    ('devolucao_lamina', 4, 'Entregue ao solicitante', 'recepcao', 'Material entregue'),
    ('segunda_opiniao', 1, 'Recebida pelo laboratório', 'recepcao', 'Solicitação recebida'),
    ('segunda_opiniao', 2, 'Lâminas separadas', 'histotecnica', 'Material sendo preparado'),
    ('segunda_opiniao', 3, 'Enviadas ao consultor', 'microscopia', 'Em análise com o consultor'),
    ('segunda_opiniao', 4, 'Parecer recebido', 'microscopia', 'Parecer recebido'),
    ('segunda_opiniao', 5, 'Enviado ao solicitante', 'microscopia', 'Parecer enviado'),
    ('copia_laudo', 1, 'Recebida pela recepção', 'recepcao', 'Solicitação recebida'),
    ('copia_laudo', 2, 'Laudo localizado', 'recepcao', 'Documento localizado'),
    ('copia_laudo', 3, 'Enviado ao solicitante', 'recepcao', 'Documento enviado')
) AS v(chave, ordem, rotulo, setor, texto_portal) ON v.chave = ts.chave
ON CONFLICT ("tenant_id", "tipo_id", "ordem") DO NOTHING;
