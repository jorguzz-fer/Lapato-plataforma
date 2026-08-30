CREATE TYPE "public"."status_ordem_servico" AS ENUM('aberta', 'conferida', 'despachada', 'faturada', 'cancelada');--> statement-breakpoint
CREATE TABLE "item_ordem_servico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ordem_id" uuid NOT NULL,
	"servico_id" uuid,
	"descricao" text NOT NULL,
	"quantidade" numeric(10, 2) DEFAULT '1' NOT NULL,
	"valor_unitario" numeric(12, 2) NOT NULL,
	"desconto_percentual" numeric(5, 2) DEFAULT '0' NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ordem_servico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"caso_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"status" "status_ordem_servico" DEFAULT 'aberta' NOT NULL,
	"observacoes" text,
	"conferida_em" timestamp with time zone,
	"conferida_por_id" uuid,
	"despachada_em" timestamp with time zone,
	"despachada_por_id" uuid,
	"cancelada_em" timestamp with time zone,
	"motivo_cancelamento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ordem_identificador" UNIQUE("tenant_id","identificador"),
	CONSTRAINT "uq_ordem_caso" UNIQUE("tenant_id","caso_id")
);
--> statement-breakpoint
CREATE TABLE "preco_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"servico_id" uuid NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_preco_cliente" UNIQUE("tenant_id","cliente_id","servico_id")
);
--> statement-breakpoint
ALTER TABLE "servico" ADD COLUMN "valor_padrao" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "item_ordem_servico" ADD CONSTRAINT "item_ordem_servico_ordem_id_ordem_servico_id_fk" FOREIGN KEY ("ordem_id") REFERENCES "public"."ordem_servico"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ordem_servico" ADD CONSTRAINT "item_ordem_servico_servico_id_servico_id_fk" FOREIGN KEY ("servico_id") REFERENCES "public"."servico"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_conferida_por_id_usuario_id_fk" FOREIGN KEY ("conferida_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_despachada_por_id_usuario_id_fk" FOREIGN KEY ("despachada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preco_cliente" ADD CONSTRAINT "preco_cliente_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preco_cliente" ADD CONSTRAINT "preco_cliente_servico_id_servico_id_fk" FOREIGN KEY ("servico_id") REFERENCES "public"."servico"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_item_ordem" ON "item_ordem_servico" USING btree ("tenant_id","ordem_id");--> statement-breakpoint
CREATE INDEX "idx_ordem_status" ON "ordem_servico" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_ordem_cliente" ON "ordem_servico" USING btree ("tenant_id","cliente_id");--> statement-breakpoint
CREATE INDEX "idx_preco_cliente_cliente" ON "preco_cliente" USING btree ("tenant_id","cliente_id");