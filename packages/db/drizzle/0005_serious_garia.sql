CREATE TYPE "public"."cavidade_necropsia" AS ENUM('externo', 'toracica', 'abdominal', 'pelvica', 'craniana', 'canal_vertebral', 'articulacoes', 'outra');--> statement-breakpoint
CREATE TYPE "public"."classificacao_lesao" AS ENUM('processo_principal', 'processo_secundario', 'contribuinte', 'incidental', 'post_mortem', 'artefato', 'indeterminada');--> statement-breakpoint
CREATE TYPE "public"."conservacao_necropsia" AS ENUM('fresco', 'refrigerado', 'congelado_descongelado', 'autolise_leve', 'autolise_moderada', 'autolise_acentuada', 'decomposicao');--> statement-breakpoint
CREATE TYPE "public"."estado_exame_orgao" AS ENUM('sem_alteracoes', 'alterado', 'nao_examinado');--> statement-breakpoint
CREATE TYPE "public"."grau_certeza_causa" AS ENUM('estabelecida', 'altamente_provavel', 'provavel', 'possivel', 'indeterminada');--> statement-breakpoint
CREATE TYPE "public"."mecanismo_terminal" AS ENUM('insuficiencia_respiratoria', 'choque_hipovolemico', 'choque_cardiogenico', 'choque_distributivo', 'choque_obstrutivo', 'insuficiencia_circulatoria', 'tamponamento', 'hipertensao_intracraniana', 'falencia_multiorganica', 'outro', 'indeterminado');--> statement-breakpoint
CREATE TYPE "public"."modalidade_necropsia" AS ENUM('diagnostica', 'fotodocumentada', 'forense', 'parcial');--> statement-breakpoint
CREATE TYPE "public"."tipo_relacao_lesao" AS ENUM('causou', 'contribuiu_para', 'associada_a');--> statement-breakpoint
CREATE TABLE "causa_mortis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"necropsia_id" uuid NOT NULL,
	"causa_imediata" text,
	"condicao_antecedente" text,
	"causa_basica" text,
	"condicoes_contribuintes" text,
	"mecanismo_terminal" "mecanismo_terminal",
	"grau_certeza" "grau_certeza_causa" DEFAULT 'indeterminada' NOT NULL,
	"diagnosticos_diferenciais" jsonb DEFAULT '[]'::jsonb,
	"conclusao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_causa_mortis_necropsia" UNIQUE("tenant_id","necropsia_id")
);
--> statement-breakpoint
CREATE TABLE "exame_orgao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"necropsia_id" uuid NOT NULL,
	"cavidade" "cavidade_necropsia" NOT NULL,
	"sistema" text,
	"orgao" text NOT NULL,
	"estado" "estado_exame_orgao" NOT NULL,
	"descricao" text,
	"peso_gramas" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_exame_orgao" UNIQUE("tenant_id","necropsia_id","cavidade","orgao")
);
--> statement-breakpoint
CREATE TABLE "lesao_necroscopica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"necropsia_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"orgao" text NOT NULL,
	"descricao" text NOT NULL,
	"localizacao" text,
	"distribuicao" text,
	"dimensao" text,
	"diagnostico_morfologico" text,
	"classificacao" "classificacao_lesao",
	"impressao_macroscopica" text,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lesao_codigo" UNIQUE("tenant_id","necropsia_id","codigo")
);
--> statement-breakpoint
CREATE TABLE "necropsia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"cadaver_id" uuid,
	"modalidade" "modalidade_necropsia" DEFAULT 'diagnostica' NOT NULL,
	"responsavel_solicitacao" text NOT NULL,
	"contato_responsavel" text,
	"conservacao" "conservacao_necropsia",
	"obito_em" timestamp with time zone,
	"circunstancias_morte" text,
	"perguntas_solicitante" text,
	"exame_externo" jsonb DEFAULT '{}'::jsonb,
	"limitacoes" jsonb DEFAULT '[]'::jsonb,
	"limitacoes_observacao" text,
	"iniciada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"iniciada_por_id" uuid,
	"concluida_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_necropsia_caso" UNIQUE("tenant_id","caso_id")
);
--> statement-breakpoint
CREATE TABLE "relacao_lesao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"necropsia_id" uuid NOT NULL,
	"origem_id" uuid NOT NULL,
	"destino_id" uuid NOT NULL,
	"tipo" "tipo_relacao_lesao" DEFAULT 'causou' NOT NULL,
	"observacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_relacao_lesao" UNIQUE("tenant_id","origem_id","destino_id")
);
--> statement-breakpoint
ALTER TABLE "causa_mortis" ADD CONSTRAINT "causa_mortis_necropsia_id_necropsia_id_fk" FOREIGN KEY ("necropsia_id") REFERENCES "public"."necropsia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exame_orgao" ADD CONSTRAINT "exame_orgao_necropsia_id_necropsia_id_fk" FOREIGN KEY ("necropsia_id") REFERENCES "public"."necropsia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesao_necroscopica" ADD CONSTRAINT "lesao_necroscopica_necropsia_id_necropsia_id_fk" FOREIGN KEY ("necropsia_id") REFERENCES "public"."necropsia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "necropsia" ADD CONSTRAINT "necropsia_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "necropsia" ADD CONSTRAINT "necropsia_cadaver_id_cadaver_id_fk" FOREIGN KEY ("cadaver_id") REFERENCES "public"."cadaver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "necropsia" ADD CONSTRAINT "necropsia_iniciada_por_id_usuario_id_fk" FOREIGN KEY ("iniciada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relacao_lesao" ADD CONSTRAINT "relacao_lesao_necropsia_id_necropsia_id_fk" FOREIGN KEY ("necropsia_id") REFERENCES "public"."necropsia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relacao_lesao" ADD CONSTRAINT "relacao_lesao_origem_id_lesao_necroscopica_id_fk" FOREIGN KEY ("origem_id") REFERENCES "public"."lesao_necroscopica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relacao_lesao" ADD CONSTRAINT "relacao_lesao_destino_id_lesao_necroscopica_id_fk" FOREIGN KEY ("destino_id") REFERENCES "public"."lesao_necroscopica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exame_orgao_necropsia" ON "exame_orgao" USING btree ("tenant_id","necropsia_id");--> statement-breakpoint
CREATE INDEX "idx_lesao_necropsia" ON "lesao_necroscopica" USING btree ("tenant_id","necropsia_id");--> statement-breakpoint
CREATE INDEX "idx_necropsia_caso" ON "necropsia" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_relacao_necropsia" ON "relacao_lesao" USING btree ("tenant_id","necropsia_id");