CREATE TYPE "public"."status_fatura" AS ENUM('aberta', 'emitida', 'paga', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."tipo_lancamento" AS ENUM('entrada', 'saida');--> statement-breakpoint
CREATE TABLE "fatura" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"cliente_id" uuid NOT NULL,
	"status" "status_fatura" DEFAULT 'aberta' NOT NULL,
	"vencimento" date,
	"emitida_em" timestamp with time zone,
	"emitida_por_id" uuid,
	"paga_em" timestamp with time zone,
	"valor_pago" numeric(12, 2),
	"cancelada_em" timestamp with time zone,
	"motivo_cancelamento" text,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_fatura_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "lancamento_financeiro" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tipo" "tipo_lancamento" NOT NULL,
	"categoria" text NOT NULL,
	"descricao" text NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"data" date NOT NULL,
	"fatura_id" uuid,
	"criado_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD COLUMN "fatura_id" uuid;--> statement-breakpoint
ALTER TABLE "fatura" ADD CONSTRAINT "fatura_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fatura" ADD CONSTRAINT "fatura_emitida_por_id_usuario_id_fk" FOREIGN KEY ("emitida_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamento_financeiro" ADD CONSTRAINT "lancamento_financeiro_fatura_id_fatura_id_fk" FOREIGN KEY ("fatura_id") REFERENCES "public"."fatura"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamento_financeiro" ADD CONSTRAINT "lancamento_financeiro_criado_por_id_usuario_id_fk" FOREIGN KEY ("criado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fatura_status" ON "fatura" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_fatura_cliente" ON "fatura" USING btree ("tenant_id","cliente_id");--> statement-breakpoint
CREATE INDEX "idx_lancamento_data" ON "lancamento_financeiro" USING btree ("tenant_id","data");--> statement-breakpoint
CREATE INDEX "idx_lancamento_fatura" ON "lancamento_financeiro" USING btree ("tenant_id","fatura_id");--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_fatura_id_fatura_id_fk" FOREIGN KEY ("fatura_id") REFERENCES "public"."fatura"("id") ON DELETE set null ON UPDATE no action;