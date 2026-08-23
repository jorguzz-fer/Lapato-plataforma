CREATE TYPE "public"."adequacao_citologica" AS ENUM('adequada', 'adequada_com_limitacoes', 'pouco_representativa', 'insatisfatoria', 'nao_diagnostica');--> statement-breakpoint
CREATE TYPE "public"."celularidade" AS ENUM('acelular', 'muito_baixa', 'baixa', 'moderada', 'alta', 'muito_alta');--> statement-breakpoint
CREATE TYPE "public"."intensidade" AS ENUM('ausente', 'discreta', 'moderada', 'acentuada');--> statement-breakpoint
CREATE TYPE "public"."preservacao_celular" AS ENUM('excelente', 'boa', 'moderada', 'ruim', 'acentuadamente_degenerada');--> statement-breakpoint
CREATE TABLE "avaliacao_citologica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"laudo_versao_id" uuid NOT NULL,
	"amostra_id" uuid NOT NULL,
	"tipo_coleta" text,
	"sitio" text,
	"numero_laminas" integer,
	"coloracoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"adequacao" "adequacao_citologica",
	"motivos_limitacao" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"celularidade" "celularidade",
	"preservacao" "preservacao_celular",
	"fundo" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hemorragia" "intensidade",
	"achados_hemorragia" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"necrose" "intensidade",
	"material_extracelular" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"populacoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criterios_malignidade" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mitoses" text,
	"inflamacao" jsonb,
	"agentes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"descricao_citologica" text,
	"interpretacao" text,
	"grau_certeza" text,
	"limitacoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recomendacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_citologia_versao_amostra" UNIQUE("laudo_versao_id","amostra_id")
);
--> statement-breakpoint
ALTER TABLE "avaliacao_citologica" ADD CONSTRAINT "avaliacao_citologica_laudo_versao_id_laudo_versao_id_fk" FOREIGN KEY ("laudo_versao_id") REFERENCES "public"."laudo_versao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avaliacao_citologica" ADD CONSTRAINT "avaliacao_citologica_amostra_id_amostra_id_fk" FOREIGN KEY ("amostra_id") REFERENCES "public"."amostra"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_citologia_versao" ON "avaliacao_citologica" USING btree ("tenant_id","laudo_versao_id");--> statement-breakpoint
CREATE INDEX "idx_citologia_adequacao" ON "avaliacao_citologica" USING btree ("tenant_id","adequacao");