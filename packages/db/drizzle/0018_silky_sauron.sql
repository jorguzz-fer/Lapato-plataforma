CREATE TYPE "public"."categoria_documento" AS ENUM('recebimento_triagem', 'citopatologia', 'histopatologia', 'macroscopia', 'processamento', 'coloracoes', 'microscopia_diagnostico', 'necropsia', 'medicina_legal', 'bioteca', 'logistica', 'qualidade', 'biosseguranca', 'ensino', 'administracao', 'outros');--> statement-breakpoint
CREATE TYPE "public"."contexto_biblioteca" AS ENUM('recebimento', 'macroscopia', 'processamento', 'microscopia', 'necropsia', 'logistica', 'bioteca', 'portal', 'emergencia');--> statement-breakpoint
CREATE TYPE "public"."desfecho_revisao" AS ENUM('comentario', 'ajuste_solicitado', 'revisao_concluida');--> statement-breakpoint
CREATE TYPE "public"."publico_documento" AS ENUM('colaboradores', 'gestores', 'clientes', 'restrito');--> statement-breakpoint
CREATE TYPE "public"."status_documento" AS ENUM('rascunho', 'publicado', 'obsoleto', 'arquivado');--> statement-breakpoint
CREATE TYPE "public"."status_versao_documento" AS ENUM('rascunho', 'em_revisao', 'aguardando_aprovacao', 'aprovada', 'vigente', 'obsoleta');--> statement-breakpoint
CREATE TYPE "public"."tipo_documento" AS ENUM('pop', 'protocolo', 'instrucao_trabalho', 'manual', 'norma_interna', 'guia', 'criterio_diagnostico', 'classificacao', 'artigo', 'referencia', 'documento_regulatorio', 'material_treinamento', 'faq', 'modelo', 'outro');--> statement-breakpoint
CREATE TYPE "public"."tipo_feedback_documento" AS ENUM('util', 'erro', 'desatualizado', 'precisa_revisao', 'solicitacao_novo');--> statement-breakpoint
CREATE TABLE "ciencia_documento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"versao_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"confirmada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ciencia_versao_usuario" UNIQUE("versao_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "comentario_revisao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"versao_id" uuid NOT NULL,
	"autor_id" uuid,
	"desfecho" "desfecho_revisao" DEFAULT 'comentario' NOT NULL,
	"texto" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documento_biblioteca" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"titulo" text NOT NULL,
	"tipo" "tipo_documento" NOT NULL,
	"categoria" "categoria_documento" NOT NULL,
	"subcategoria" text,
	"colecoes" text[] DEFAULT '{}' NOT NULL,
	"palavras_chave" text[] DEFAULT '{}' NOT NULL,
	"resumo" text,
	"responsavel_id" uuid,
	"publico" "publico_documento" DEFAULT 'colaboradores' NOT NULL,
	"contextos" "contexto_biblioteca"[] DEFAULT '{}' NOT NULL,
	"status" "status_documento" DEFAULT 'rascunho' NOT NULL,
	"exige_aprovacao" boolean DEFAULT false NOT NULL,
	"exige_ciencia" boolean DEFAULT false NOT NULL,
	"critico" boolean DEFAULT false NOT NULL,
	"permite_download" boolean DEFAULT true NOT NULL,
	"revisao_periodica_meses" integer,
	"proxima_revisao_em" date,
	"versao_vigente_id" uuid,
	"acessos" integer DEFAULT 0 NOT NULL,
	"obsoleto_em" timestamp with time zone,
	"arquivado_em" timestamp with time zone,
	"motivo_saida" text,
	"criado_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_documento_biblioteca_codigo" UNIQUE("tenant_id","codigo")
);
--> statement-breakpoint
CREATE TABLE "feedback_documento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"documento_id" uuid,
	"usuario_id" uuid,
	"tipo" "tipo_feedback_documento" NOT NULL,
	"texto" text,
	"tratado_em" timestamp with time zone,
	"tratado_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "versao_documento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"documento_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"status" "status_versao_documento" DEFAULT 'rascunho' NOT NULL,
	"conteudo" text,
	"arquivo_chave" text,
	"arquivo_nome" text,
	"arquivo_mime" text,
	"arquivo_tamanho" integer,
	"arquivo_hash" text,
	"link_externo" text,
	"motivo_revisao" text,
	"autor_id" uuid,
	"enviada_revisao_em" timestamp with time zone,
	"revisao_concluida_em" timestamp with time zone,
	"revisada_por_id" uuid,
	"aprovada_por_id" uuid,
	"aprovada_em" timestamp with time zone,
	"publicada_por_id" uuid,
	"publicada_em" timestamp with time zone,
	"obsoleta_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_versao_documento_numero" UNIQUE("documento_id","numero")
);
--> statement-breakpoint
ALTER TABLE "ciencia_documento" ADD CONSTRAINT "ciencia_documento_versao_id_versao_documento_id_fk" FOREIGN KEY ("versao_id") REFERENCES "public"."versao_documento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciencia_documento" ADD CONSTRAINT "ciencia_documento_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comentario_revisao" ADD CONSTRAINT "comentario_revisao_versao_id_versao_documento_id_fk" FOREIGN KEY ("versao_id") REFERENCES "public"."versao_documento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comentario_revisao" ADD CONSTRAINT "comentario_revisao_autor_id_usuario_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento_biblioteca" ADD CONSTRAINT "documento_biblioteca_responsavel_id_usuario_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento_biblioteca" ADD CONSTRAINT "documento_biblioteca_criado_por_id_usuario_id_fk" FOREIGN KEY ("criado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_documento" ADD CONSTRAINT "feedback_documento_documento_id_documento_biblioteca_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documento_biblioteca"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_documento" ADD CONSTRAINT "feedback_documento_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_documento" ADD CONSTRAINT "feedback_documento_tratado_por_id_usuario_id_fk" FOREIGN KEY ("tratado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versao_documento" ADD CONSTRAINT "versao_documento_documento_id_documento_biblioteca_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documento_biblioteca"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versao_documento" ADD CONSTRAINT "versao_documento_autor_id_usuario_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versao_documento" ADD CONSTRAINT "versao_documento_revisada_por_id_usuario_id_fk" FOREIGN KEY ("revisada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versao_documento" ADD CONSTRAINT "versao_documento_aprovada_por_id_usuario_id_fk" FOREIGN KEY ("aprovada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versao_documento" ADD CONSTRAINT "versao_documento_publicada_por_id_usuario_id_fk" FOREIGN KEY ("publicada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ciencia_documento" ON "ciencia_documento" USING btree ("tenant_id","versao_id");--> statement-breakpoint
CREATE INDEX "idx_comentario_revisao" ON "comentario_revisao" USING btree ("tenant_id","versao_id");--> statement-breakpoint
CREATE INDEX "idx_documento_biblioteca_status" ON "documento_biblioteca" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_documento_biblioteca_categoria" ON "documento_biblioteca" USING btree ("tenant_id","categoria");--> statement-breakpoint
CREATE INDEX "idx_documento_biblioteca_revisao" ON "documento_biblioteca" USING btree ("tenant_id","proxima_revisao_em");--> statement-breakpoint
CREATE INDEX "idx_feedback_documento" ON "feedback_documento" USING btree ("tenant_id","documento_id");--> statement-breakpoint
CREATE INDEX "idx_versao_documento" ON "versao_documento" USING btree ("tenant_id","documento_id","status");