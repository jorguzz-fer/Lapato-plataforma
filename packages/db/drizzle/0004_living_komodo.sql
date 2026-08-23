CREATE TYPE "public"."conservacao_cadaver" AS ENUM('refrigerado', 'congelado', 'temperatura_ambiente', 'outro', 'nao_informado');--> statement-breakpoint
CREATE TYPE "public"."destinacao_cadaver" AS ENUM('retirada_responsavel', 'cremacao_individual', 'cremacao_coletiva', 'destinacao_institucional', 'outra');--> statement-breakpoint
CREATE TYPE "public"."embalagem_cadaver" AS ENUM('saco_plastico', 'saco_cadaverico', 'caixa', 'recipiente_rigido', 'embalagem_dupla', 'outra');--> statement-breakpoint
CREATE TYPE "public"."identificacao_externa" AS ENUM('presente', 'ausente', 'incompleta', 'divergente');--> statement-breakpoint
CREATE TYPE "public"."integridade_cadaver" AS ENUM('integra', 'rompida', 'vazamento', 'sujidade_externa', 'inadequada');--> statement-breakpoint
CREATE TYPE "public"."status_cadaver" AS ENUM('aguardando_recebimento', 'recebido', 'armazenado', 'aguardando_necropsia', 'em_necropsia', 'aguardando_liberacao', 'liberado', 'retirado', 'destinado');--> statement-breakpoint
CREATE TYPE "public"."tipo_bloqueio_cadaver" AS ENUM('nao_liberar', 'aguardar_exame_complementar', 'aguardar_autorizacao', 'caso_pericial', 'documentacao_pendente', 'retencao_tecnica', 'retencao_legal', 'outro');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimentacao_cadaver" AS ENUM('recebimento', 'armazenamento', 'transferencia', 'retirada_necropsia', 'retorno_necropsia', 'mudanca_conservacao', 'saida_fisica', 'correcao');--> statement-breakpoint
CREATE TABLE "bloqueio_cadaver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cadaver_id" uuid NOT NULL,
	"tipo" "tipo_bloqueio_cadaver" NOT NULL,
	"motivo" text NOT NULL,
	"criado_por_id" uuid,
	"resolvido_em" timestamp with time zone,
	"resolvido_por_id" uuid,
	"justificativa_resolucao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cadaver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"caso_id" uuid,
	"nome_animal" text,
	"especie" text NOT NULL,
	"sexo" text,
	"raca" text,
	"pelagem" text,
	"microchip" text,
	"origem_responsavel" text,
	"recebido_em" timestamp with time zone,
	"recebido_por_id" uuid,
	"obito_em" timestamp with time zone,
	"conservacao_recebimento" "conservacao_cadaver",
	"embalagem" "embalagem_cadaver",
	"integridade" "integridade_cadaver",
	"identificacao_externa" "identificacao_externa",
	"observacoes_recebimento" text,
	"status" "status_cadaver" DEFAULT 'aguardando_recebimento' NOT NULL,
	"local_atual_id" uuid,
	"local_anterior_id" uuid,
	"conservacao_atual" "conservacao_cadaver",
	"fora_desde" timestamp with time zone,
	"prazo_guarda_ate" timestamp with time zone,
	"destinacao" "destinacao_cadaver",
	"destinacao_definida_em" timestamp with time zone,
	"liberado_em" timestamp with time zone,
	"liberado_por_id" uuid,
	"retirado_em" timestamp with time zone,
	"retirado_por_nome" text,
	"retirado_por_documento" text,
	"retirado_por_vinculo" text,
	"retirado_por_empresa" text,
	"entrega_registrada_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cadaver_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "destinacao_cadaver_historico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cadaver_id" uuid NOT NULL,
	"anterior" "destinacao_cadaver",
	"nova" "destinacao_cadaver" NOT NULL,
	"justificativa" text,
	"definida_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movimentacao_cadaver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cadaver_id" uuid NOT NULL,
	"tipo" "tipo_movimentacao_cadaver" NOT NULL,
	"origem_local_id" uuid,
	"destino_local_id" uuid,
	"destino_descricao" text,
	"conservacao" "conservacao_cadaver",
	"motivo" text,
	"observacao" text,
	"ocorrido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bloqueio_cadaver" ADD CONSTRAINT "bloqueio_cadaver_cadaver_id_cadaver_id_fk" FOREIGN KEY ("cadaver_id") REFERENCES "public"."cadaver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloqueio_cadaver" ADD CONSTRAINT "bloqueio_cadaver_criado_por_id_usuario_id_fk" FOREIGN KEY ("criado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloqueio_cadaver" ADD CONSTRAINT "bloqueio_cadaver_resolvido_por_id_usuario_id_fk" FOREIGN KEY ("resolvido_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadaver" ADD CONSTRAINT "cadaver_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadaver" ADD CONSTRAINT "cadaver_recebido_por_id_usuario_id_fk" FOREIGN KEY ("recebido_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadaver" ADD CONSTRAINT "cadaver_local_atual_id_local_fisico_id_fk" FOREIGN KEY ("local_atual_id") REFERENCES "public"."local_fisico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadaver" ADD CONSTRAINT "cadaver_local_anterior_id_local_fisico_id_fk" FOREIGN KEY ("local_anterior_id") REFERENCES "public"."local_fisico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadaver" ADD CONSTRAINT "cadaver_liberado_por_id_usuario_id_fk" FOREIGN KEY ("liberado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadaver" ADD CONSTRAINT "cadaver_entrega_registrada_por_id_usuario_id_fk" FOREIGN KEY ("entrega_registrada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destinacao_cadaver_historico" ADD CONSTRAINT "destinacao_cadaver_historico_cadaver_id_cadaver_id_fk" FOREIGN KEY ("cadaver_id") REFERENCES "public"."cadaver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destinacao_cadaver_historico" ADD CONSTRAINT "destinacao_cadaver_historico_definida_por_id_usuario_id_fk" FOREIGN KEY ("definida_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao_cadaver" ADD CONSTRAINT "movimentacao_cadaver_cadaver_id_cadaver_id_fk" FOREIGN KEY ("cadaver_id") REFERENCES "public"."cadaver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao_cadaver" ADD CONSTRAINT "movimentacao_cadaver_origem_local_id_local_fisico_id_fk" FOREIGN KEY ("origem_local_id") REFERENCES "public"."local_fisico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao_cadaver" ADD CONSTRAINT "movimentacao_cadaver_destino_local_id_local_fisico_id_fk" FOREIGN KEY ("destino_local_id") REFERENCES "public"."local_fisico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao_cadaver" ADD CONSTRAINT "movimentacao_cadaver_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bloqueio_cadaver" ON "bloqueio_cadaver" USING btree ("tenant_id","cadaver_id");--> statement-breakpoint
CREATE INDEX "idx_cadaver_status" ON "cadaver" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_cadaver_caso" ON "cadaver" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_cadaver_local" ON "cadaver" USING btree ("tenant_id","local_atual_id");--> statement-breakpoint
CREATE INDEX "idx_destinacao_cadaver" ON "destinacao_cadaver_historico" USING btree ("tenant_id","cadaver_id");--> statement-breakpoint
CREATE INDEX "idx_movimentacao_cadaver" ON "movimentacao_cadaver" USING btree ("tenant_id","cadaver_id","ocorrido_em");