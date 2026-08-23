CREATE TYPE "public"."condicao_objeto" AS ENUM('integro', 'adequado', 'danificado', 'quebrado', 'descolado', 'ilegivel', 'deteriorado', 'contaminado', 'insuficiente', 'esgotado');--> statement-breakpoint
CREATE TYPE "public"."divergencia_inventario" AS ENUM('nao_localizado', 'posicao_incorreta', 'nao_cadastrado', 'condicao_divergente');--> statement-breakpoint
CREATE TYPE "public"."finalidade_uso" AS ENUM('diagnostico', 'complementar', 'pericia', 'segunda_opiniao', 'controle_qualidade', 'ensino', 'pesquisa');--> statement-breakpoint
CREATE TYPE "public"."metodo_descarte" AS ENUM('incineracao', 'residuo_infectante', 'residuo_quimico', 'sepultamento', 'devolucao_ao_tutor', 'transferencia_institucional', 'outro');--> statement-breakpoint
CREATE TYPE "public"."motivo_retencao_ampliada" AS ENUM('litigio', 'pericia', 'pesquisa', 'ensino', 'interesse_cientifico', 'solicitacao_responsavel', 'outro');--> statement-breakpoint
CREATE TYPE "public"."restricao_objeto" AS ENUM('nao_emprestar', 'nao_consumir', 'nao_descartar', 'confidencial', 'restricao_pericial', 'preservacao_especial');--> statement-breakpoint
CREATE TYPE "public"."status_emprestimo" AS ENUM('aberto', 'devolvido_parcial', 'devolvido', 'atrasado', 'nao_devolvido');--> statement-breakpoint
CREATE TYPE "public"."status_objeto_biologico" AS ENUM('disponivel', 'arquivado', 'reservado', 'emprestado', 'em_uso', 'enviado', 'aguardando_devolucao', 'parcialmente_consumido', 'proximo_esgotamento', 'esgotado', 'bloqueado', 'nao_localizado', 'perdido', 'descartado');--> statement-breakpoint
CREATE TYPE "public"."tipo_emprestimo" AS ENUM('interno', 'externo');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimentacao_objeto" AS ENUM('arquivamento', 'retirada', 'devolucao', 'transferencia', 'emprestimo_saida', 'emprestimo_retorno', 'correcao_localizacao', 'consumo', 'mudanca_condicao', 'inventario', 'descarte');--> statement-breakpoint
CREATE TYPE "public"."tipo_objeto_biologico" AS ENUM('tecido_fixado', 'bloco_parafina', 'lamina_histologica', 'lamina_citologica', 'cell_block', 'tecido_congelado', 'material_toxicologico', 'material_molecular', 'peca_anatomica', 'especime_didatico', 'outro');--> statement-breakpoint
CREATE TABLE "colecao_biologica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"finalidade" "finalidade_uso",
	"projeto" text,
	"criada_por_id" uuid,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_colecao_nome" UNIQUE("tenant_id","nome")
);
--> statement-breakpoint
CREATE TABLE "colecao_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"colecao_id" uuid NOT NULL,
	"objeto_id" uuid NOT NULL,
	"nota" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_colecao_item" UNIQUE("colecao_id","objeto_id")
);
--> statement-breakpoint
CREATE TABLE "emprestimo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"tipo" "tipo_emprestimo" NOT NULL,
	"finalidade" "finalidade_uso" NOT NULL,
	"destinatario" text NOT NULL,
	"contato_destinatario" text,
	"unidade_destino_id" uuid,
	"condicoes" text,
	"status" "status_emprestimo" DEFAULT 'aberto' NOT NULL,
	"prazo_devolucao" date NOT NULL,
	"emprestado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"emprestado_por_id" uuid,
	"encerrado_em" timestamp with time zone,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_emprestimo_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "emprestimo_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"emprestimo_id" uuid NOT NULL,
	"objeto_id" uuid NOT NULL,
	"quantidade" integer DEFAULT 1 NOT NULL,
	"devolvido_em" timestamp with time zone,
	"condicao_devolucao" "condicao_objeto",
	"observacao_devolucao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_emprestimo_item" UNIQUE("emprestimo_id","objeto_id")
);
--> statement-breakpoint
CREATE TABLE "inventario_bioteca" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"descricao" text,
	"local_id" uuid,
	"tipo_filtro" "tipo_objeto_biologico",
	"iniciado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"iniciado_por_id" uuid,
	"concluido_em" timestamp with time zone,
	"resumo" jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_inventario_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "inventario_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inventario_id" uuid NOT NULL,
	"objeto_id" uuid,
	"codigo_lido" text,
	"encontrado" boolean DEFAULT false NOT NULL,
	"local_esperado_id" uuid,
	"local_encontrado_id" uuid,
	"divergencia" "divergencia_inventario",
	"condicao_encontrada" "condicao_objeto",
	"reconciliado_em" timestamp with time zone,
	"reconciliado_por_id" uuid,
	"justificativa_reconciliacao" text,
	"registrado_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lote_descarte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"metodo" "metodo_descarte" NOT NULL,
	"empresa" text,
	"observacoes" text,
	"executado_em" timestamp with time zone,
	"autorizado_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lote_descarte_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "movimentacao_objeto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"objeto_id" uuid NOT NULL,
	"tipo" "tipo_movimentacao_objeto" NOT NULL,
	"origem_local_id" uuid,
	"destino_local_id" uuid,
	"destino_descritivo" text,
	"finalidade" "finalidade_uso",
	"quantidade" integer,
	"status_anterior" "status_objeto_biologico",
	"status_novo" "status_objeto_biologico",
	"condicao_registrada" "condicao_objeto",
	"motivo" text,
	"observacao" text,
	"previsao_devolucao" timestamp with time zone,
	"registrada_por_id" uuid,
	"registrada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objeto_biologico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"tipo" "tipo_objeto_biologico" NOT NULL,
	"descricao" text,
	"caso_id" uuid,
	"amostra_id" uuid,
	"bloco_id" uuid,
	"lamina_id" uuid,
	"objeto_pai_id" uuid,
	"orgao" text,
	"status" "status_objeto_biologico" DEFAULT 'disponivel' NOT NULL,
	"condicao" "condicao_objeto" DEFAULT 'integro' NOT NULL,
	"local_origem_id" uuid,
	"local_atual_id" uuid,
	"localizacao_descritiva" text,
	"quantidade_inicial" integer DEFAULT 1 NOT NULL,
	"quantidade_disponivel" integer DEFAULT 1 NOT NULL,
	"recipiente" text,
	"fixador" text,
	"temperatura_prevista" text,
	"restricoes" "restricao_objeto"[] DEFAULT '{}' NOT NULL,
	"retencao_ate" date,
	"preservacao_especial" boolean DEFAULT false NOT NULL,
	"motivo_retencao_ampliada" "motivo_retencao_ampliada",
	"justificativa_retencao" text,
	"arquivado_em" timestamp with time zone,
	"arquivado_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_objeto_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "reserva_objeto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"objeto_id" uuid NOT NULL,
	"finalidade" "finalidade_uso" NOT NULL,
	"projeto" text,
	"justificativa" text,
	"vigencia_ate" timestamp with time zone,
	"ativa" boolean DEFAULT true NOT NULL,
	"criada_por_id" uuid,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"encerrada_em" timestamp with time zone,
	"motivo_encerramento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "colecao_biologica" ADD CONSTRAINT "colecao_biologica_criada_por_id_usuario_id_fk" FOREIGN KEY ("criada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "colecao_item" ADD CONSTRAINT "colecao_item_colecao_id_colecao_biologica_id_fk" FOREIGN KEY ("colecao_id") REFERENCES "public"."colecao_biologica"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "colecao_item" ADD CONSTRAINT "colecao_item_objeto_id_objeto_biologico_id_fk" FOREIGN KEY ("objeto_id") REFERENCES "public"."objeto_biologico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emprestimo" ADD CONSTRAINT "emprestimo_unidade_destino_id_unidade_id_fk" FOREIGN KEY ("unidade_destino_id") REFERENCES "public"."unidade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emprestimo" ADD CONSTRAINT "emprestimo_emprestado_por_id_usuario_id_fk" FOREIGN KEY ("emprestado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emprestimo_item" ADD CONSTRAINT "emprestimo_item_emprestimo_id_emprestimo_id_fk" FOREIGN KEY ("emprestimo_id") REFERENCES "public"."emprestimo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emprestimo_item" ADD CONSTRAINT "emprestimo_item_objeto_id_objeto_biologico_id_fk" FOREIGN KEY ("objeto_id") REFERENCES "public"."objeto_biologico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_bioteca" ADD CONSTRAINT "inventario_bioteca_local_id_local_fisico_id_fk" FOREIGN KEY ("local_id") REFERENCES "public"."local_fisico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_bioteca" ADD CONSTRAINT "inventario_bioteca_iniciado_por_id_usuario_id_fk" FOREIGN KEY ("iniciado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_item" ADD CONSTRAINT "inventario_item_inventario_id_inventario_bioteca_id_fk" FOREIGN KEY ("inventario_id") REFERENCES "public"."inventario_bioteca"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_item" ADD CONSTRAINT "inventario_item_objeto_id_objeto_biologico_id_fk" FOREIGN KEY ("objeto_id") REFERENCES "public"."objeto_biologico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_item" ADD CONSTRAINT "inventario_item_local_esperado_id_local_fisico_id_fk" FOREIGN KEY ("local_esperado_id") REFERENCES "public"."local_fisico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_item" ADD CONSTRAINT "inventario_item_local_encontrado_id_local_fisico_id_fk" FOREIGN KEY ("local_encontrado_id") REFERENCES "public"."local_fisico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_item" ADD CONSTRAINT "inventario_item_reconciliado_por_id_usuario_id_fk" FOREIGN KEY ("reconciliado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_item" ADD CONSTRAINT "inventario_item_registrado_por_id_usuario_id_fk" FOREIGN KEY ("registrado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_descarte" ADD CONSTRAINT "lote_descarte_autorizado_por_id_usuario_id_fk" FOREIGN KEY ("autorizado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao_objeto" ADD CONSTRAINT "movimentacao_objeto_objeto_id_objeto_biologico_id_fk" FOREIGN KEY ("objeto_id") REFERENCES "public"."objeto_biologico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao_objeto" ADD CONSTRAINT "movimentacao_objeto_origem_local_id_local_fisico_id_fk" FOREIGN KEY ("origem_local_id") REFERENCES "public"."local_fisico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao_objeto" ADD CONSTRAINT "movimentacao_objeto_destino_local_id_local_fisico_id_fk" FOREIGN KEY ("destino_local_id") REFERENCES "public"."local_fisico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacao_objeto" ADD CONSTRAINT "movimentacao_objeto_registrada_por_id_usuario_id_fk" FOREIGN KEY ("registrada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objeto_biologico" ADD CONSTRAINT "objeto_biologico_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objeto_biologico" ADD CONSTRAINT "objeto_biologico_amostra_id_amostra_id_fk" FOREIGN KEY ("amostra_id") REFERENCES "public"."amostra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objeto_biologico" ADD CONSTRAINT "objeto_biologico_bloco_id_bloco_id_fk" FOREIGN KEY ("bloco_id") REFERENCES "public"."bloco"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objeto_biologico" ADD CONSTRAINT "objeto_biologico_lamina_id_lamina_id_fk" FOREIGN KEY ("lamina_id") REFERENCES "public"."lamina"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objeto_biologico" ADD CONSTRAINT "objeto_biologico_local_origem_id_local_fisico_id_fk" FOREIGN KEY ("local_origem_id") REFERENCES "public"."local_fisico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objeto_biologico" ADD CONSTRAINT "objeto_biologico_local_atual_id_local_fisico_id_fk" FOREIGN KEY ("local_atual_id") REFERENCES "public"."local_fisico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objeto_biologico" ADD CONSTRAINT "objeto_biologico_arquivado_por_id_usuario_id_fk" FOREIGN KEY ("arquivado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserva_objeto" ADD CONSTRAINT "reserva_objeto_objeto_id_objeto_biologico_id_fk" FOREIGN KEY ("objeto_id") REFERENCES "public"."objeto_biologico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserva_objeto" ADD CONSTRAINT "reserva_objeto_criada_por_id_usuario_id_fk" FOREIGN KEY ("criada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_colecao_item_objeto" ON "colecao_item" USING btree ("tenant_id","objeto_id");--> statement-breakpoint
CREATE INDEX "idx_emprestimo_status" ON "emprestimo" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_emprestimo_prazo" ON "emprestimo" USING btree ("tenant_id","prazo_devolucao");--> statement-breakpoint
CREATE INDEX "idx_emprestimo_item_objeto" ON "emprestimo_item" USING btree ("tenant_id","objeto_id");--> statement-breakpoint
CREATE INDEX "idx_inventario_local" ON "inventario_bioteca" USING btree ("tenant_id","local_id");--> statement-breakpoint
CREATE INDEX "idx_inventario_item_inv" ON "inventario_item" USING btree ("tenant_id","inventario_id");--> statement-breakpoint
CREATE INDEX "idx_inventario_item_objeto" ON "inventario_item" USING btree ("tenant_id","objeto_id");--> statement-breakpoint
CREATE INDEX "idx_movimentacao_objeto" ON "movimentacao_objeto" USING btree ("tenant_id","objeto_id");--> statement-breakpoint
CREATE INDEX "idx_movimentacao_data" ON "movimentacao_objeto" USING btree ("tenant_id","registrada_em");--> statement-breakpoint
CREATE INDEX "idx_objeto_caso" ON "objeto_biologico" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_objeto_local" ON "objeto_biologico" USING btree ("tenant_id","local_atual_id");--> statement-breakpoint
CREATE INDEX "idx_objeto_status" ON "objeto_biologico" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_objeto_tipo" ON "objeto_biologico" USING btree ("tenant_id","tipo");--> statement-breakpoint
CREATE INDEX "idx_objeto_bloco" ON "objeto_biologico" USING btree ("tenant_id","bloco_id");--> statement-breakpoint
CREATE INDEX "idx_reserva_objeto" ON "reserva_objeto" USING btree ("tenant_id","objeto_id");--> statement-breakpoint
CREATE INDEX "idx_reserva_ativa" ON "reserva_objeto" USING btree ("tenant_id","ativa");