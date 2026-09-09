CREATE TYPE "public"."condicao_material_logistica" AS ENUM('frasco_quebrado', 'vazamento', 'embalagem_inadequada', 'sem_identificacao', 'sem_refrigeracao', 'outra');--> statement-breakpoint
CREATE TYPE "public"."situacao_producao_logistica" AS ENUM('nao_lancado', 'lancado', 'incluido_em_fechamento', 'pago', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."status_rota_logistica" AS ENUM('planejada', 'em_andamento', 'encerrada');--> statement-breakpoint
CREATE TYPE "public"."tipo_ocorrencia_logistica" AS ENUM('acidente', 'atraso', 'falha_veiculo', 'vazamento', 'quebra_recipiente', 'perda_refrigeracao', 'extravio', 'interdicao_via', 'outra');--> statement-breakpoint
ALTER TYPE "public"."tipo_imagem" ADD VALUE 'evidencia_logistica';--> statement-breakpoint
CREATE TABLE "rota_logistica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"encarregado_id" uuid NOT NULL,
	"data" date NOT NULL,
	"veiculo" text,
	"status" "status_rota_logistica" DEFAULT 'planejada' NOT NULL,
	"iniciada_em" timestamp with time zone,
	"encerrada_em" timestamp with time zone,
	"observacoes" text,
	"criada_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "producao_logistica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"solicitacao_id" uuid NOT NULL,
	"encarregado_id" uuid NOT NULL,
	"tipo_servico" "tipo_servico_logistico" NOT NULL,
	"concluida_em" timestamp with time zone NOT NULL,
	"valor_centavos" integer DEFAULT 0 NOT NULL,
	"situacao" "situacao_producao_logistica" DEFAULT 'nao_lancado' NOT NULL,
	"referencia_financeira" text,
	"paga_em" timestamp with time zone,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_producao_logistica_solicitacao" UNIQUE("solicitacao_id")
);
--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "rota_id" uuid;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "ordem_na_rota" integer;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "deslocamento_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "chegada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "retirada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "transporte_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "entregue_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "volumes_recebidos" integer;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "justificativa_volumes" text;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "volumes_entregues" integer;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "condicao_material" "condicao_material_logistica"[];--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "observacao_retirada" text;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "quem_entregou" jsonb;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "recebedor" jsonb;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "geo_retirada" jsonb;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "geo_entrega" jsonb;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "com_ocorrencia" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "com_divergencia" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD COLUMN "concluida_por_id" uuid;--> statement-breakpoint
ALTER TABLE "rota_logistica" ADD CONSTRAINT "rota_logistica_encarregado_id_usuario_id_fk" FOREIGN KEY ("encarregado_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rota_logistica" ADD CONSTRAINT "rota_logistica_criada_por_id_usuario_id_fk" FOREIGN KEY ("criada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producao_logistica" ADD CONSTRAINT "producao_logistica_solicitacao_id_solicitacao_logistica_id_fk" FOREIGN KEY ("solicitacao_id") REFERENCES "public"."solicitacao_logistica"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producao_logistica" ADD CONSTRAINT "producao_logistica_encarregado_id_usuario_id_fk" FOREIGN KEY ("encarregado_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_rota_logistica_dia" ON "rota_logistica" USING btree ("tenant_id","data","encarregado_id");--> statement-breakpoint
CREATE INDEX "idx_rota_logistica_status" ON "rota_logistica" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_producao_logistica_encarregado" ON "producao_logistica" USING btree ("tenant_id","encarregado_id","concluida_em");--> statement-breakpoint
CREATE INDEX "idx_producao_logistica_situacao" ON "producao_logistica" USING btree ("tenant_id","situacao");--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD CONSTRAINT "solicitacao_logistica_concluida_por_id_usuario_id_fk" FOREIGN KEY ("concluida_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_logistica_rota" ON "solicitacao_logistica" USING btree ("tenant_id","rota_id");