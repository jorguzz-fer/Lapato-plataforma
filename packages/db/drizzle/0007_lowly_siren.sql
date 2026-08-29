CREATE TYPE "public"."canal_origem_logistico" AS ENUM('portal', 'telefone', 'whatsapp', 'presencial', 'interna', 'pre_solicitacao', 'rotina_programada', 'outro');--> statement-breakpoint
CREATE TYPE "public"."conservacao_logistica" AS ENUM('ambiente', 'refrigerado', 'congelado', 'fixado', 'sem_requisito', 'outra');--> statement-breakpoint
CREATE TYPE "public"."motivo_nao_realizacao" AS ENUM('cliente_fechado', 'material_indisponivel', 'cancelado_pelo_cliente', 'endereco_incorreto', 'sem_acesso', 'falha_operacional', 'outro');--> statement-breakpoint
CREATE TYPE "public"."prioridade_logistica" AS ENUM('rotina', 'prioritaria', 'urgente', 'programada');--> statement-breakpoint
CREATE TYPE "public"."requisito_especial_logistico" AS ENUM('refrigeracao', 'congelamento', 'fragilidade', 'cadaver', 'medico_legal', 'alto_valor_diagnostico', 'outro');--> statement-breakpoint
CREATE TYPE "public"."status_oferta" AS ENUM('enviada', 'aceita', 'recusada', 'encerrada', 'expirada');--> statement-breakpoint
CREATE TYPE "public"."status_solicitacao_logistica" AS ENUM('rascunho', 'recebida', 'aguardando_informacao', 'aguardando_triagem', 'aguardando_aceite', 'aceita', 'agendada', 'em_deslocamento', 'no_local', 'coletada', 'em_transporte', 'entregue', 'concluida', 'cancelada', 'nao_realizada');--> statement-breakpoint
CREATE TYPE "public"."tipo_operacao_logistica" AS ENUM('coleta_amostras', 'retirada_cadaver', 'entrega_recipientes', 'retirada_blocos_laminas', 'devolucao_material', 'entrega_documentos', 'transferencia_unidades', 'outra');--> statement-breakpoint
CREATE TYPE "public"."tipo_servico_logistico" AS ENUM('retirada', 'entrega');--> statement-breakpoint
CREATE TABLE "movimentacao_logistica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"solicitacao_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"status_anterior" "status_solicitacao_logistica",
	"status_novo" "status_solicitacao_logistica",
	"visivel_portal" boolean DEFAULT false NOT NULL,
	"descricao" text,
	"detalhe" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ocorrido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"responsavel_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oferta_servico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"solicitacao_id" uuid NOT NULL,
	"encarregado_id" uuid NOT NULL,
	"status" "status_oferta" DEFAULT 'enviada' NOT NULL,
	"enviada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone,
	"respondida_em" timestamp with time zone,
	"motivo_recusa" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_oferta_solicitacao_encarregado" UNIQUE("solicitacao_id","encarregado_id")
);
--> statement-breakpoint
CREATE TABLE "solicitacao_logistica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"tipo_servico" "tipo_servico_logistico" NOT NULL,
	"tipo_operacao" "tipo_operacao_logistica" NOT NULL,
	"canal_origem" "canal_origem_logistico" NOT NULL,
	"cliente_id" uuid NOT NULL,
	"unidade_id" uuid,
	"caso_id" uuid,
	"endereco" text NOT NULL,
	"ponto_referencia" text,
	"latitude" text,
	"longitude" text,
	"contato_no_local" text,
	"telefone_contato" text,
	"data_desejada" timestamp with time zone,
	"janela_inicio" text,
	"janela_fim" text,
	"volumes_estimados" integer,
	"tipo_material" text,
	"conservacao" "conservacao_logistica",
	"requisitos_especiais" "requisito_especial_logistico"[] DEFAULT '{}' NOT NULL,
	"prioridade" "prioridade_logistica" DEFAULT 'rotina' NOT NULL,
	"observacoes" text,
	"status" "status_solicitacao_logistica" DEFAULT 'recebida' NOT NULL,
	"encarregado_id" uuid,
	"aceita_em" timestamp with time zone,
	"valor_centavos" integer,
	"concluida_em" timestamp with time zone,
	"motivo_nao_realizacao" "motivo_nao_realizacao",
	"detalhe_nao_realizacao" text,
	"cancelada_em" timestamp with time zone,
	"cancelada_por_id" uuid,
	"motivo_cancelamento" text,
	"reagendamento_de_id" uuid,
	"criada_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_solicitacao_logistica_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
ALTER TABLE "movimentacao_logistica" ADD CONSTRAINT "movimentacao_logistica_solicitacao_id_solicitacao_logistica_id_fk" FOREIGN KEY ("solicitacao_id") REFERENCES "public"."solicitacao_logistica"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao_logistica" ADD CONSTRAINT "movimentacao_logistica_responsavel_id_usuario_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oferta_servico" ADD CONSTRAINT "oferta_servico_solicitacao_id_solicitacao_logistica_id_fk" FOREIGN KEY ("solicitacao_id") REFERENCES "public"."solicitacao_logistica"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oferta_servico" ADD CONSTRAINT "oferta_servico_encarregado_id_usuario_id_fk" FOREIGN KEY ("encarregado_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD CONSTRAINT "solicitacao_logistica_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD CONSTRAINT "solicitacao_logistica_unidade_id_unidade_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD CONSTRAINT "solicitacao_logistica_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD CONSTRAINT "solicitacao_logistica_encarregado_id_usuario_id_fk" FOREIGN KEY ("encarregado_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD CONSTRAINT "solicitacao_logistica_cancelada_por_id_usuario_id_fk" FOREIGN KEY ("cancelada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao_logistica" ADD CONSTRAINT "solicitacao_logistica_criada_por_id_usuario_id_fk" FOREIGN KEY ("criada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_movimentacao_logistica" ON "movimentacao_logistica" USING btree ("tenant_id","solicitacao_id","ocorrido_em");--> statement-breakpoint
CREATE INDEX "idx_oferta_encarregado" ON "oferta_servico" USING btree ("tenant_id","encarregado_id","status");--> statement-breakpoint
CREATE INDEX "idx_oferta_solicitacao" ON "oferta_servico" USING btree ("tenant_id","solicitacao_id");--> statement-breakpoint
CREATE INDEX "idx_logistica_status" ON "solicitacao_logistica" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_logistica_cliente" ON "solicitacao_logistica" USING btree ("tenant_id","cliente_id");--> statement-breakpoint
CREATE INDEX "idx_logistica_encarregado" ON "solicitacao_logistica" USING btree ("tenant_id","encarregado_id");--> statement-breakpoint
CREATE INDEX "idx_logistica_data" ON "solicitacao_logistica" USING btree ("tenant_id","data_desejada");