CREATE TABLE "faixa_tabela_preco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tabela_id" uuid NOT NULL,
	"servico_id" uuid NOT NULL,
	"quantidade" integer NOT NULL,
	"valor_total" numeric(12, 2) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_faixa_tabela_preco" UNIQUE("tenant_id","tabela_id","servico_id","quantidade")
);
--> statement-breakpoint
ALTER TABLE "recipiente" ADD COLUMN "fragmentos_recebidos" integer;--> statement-breakpoint
ALTER TABLE "recipiente" ADD COLUMN "fragmentos_multiplos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recipiente" ADD COLUMN "ressalva" text;--> statement-breakpoint
ALTER TABLE "recipiente" ADD COLUMN "ressalva_detalhe" text;--> statement-breakpoint
ALTER TABLE "faixa_tabela_preco" ADD CONSTRAINT "faixa_tabela_preco_tabela_id_tabela_preco_id_fk" FOREIGN KEY ("tabela_id") REFERENCES "public"."tabela_preco"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faixa_tabela_preco" ADD CONSTRAINT "faixa_tabela_preco_servico_id_servico_id_fk" FOREIGN KEY ("servico_id") REFERENCES "public"."servico"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_faixa_tabela_preco" ON "faixa_tabela_preco" USING btree ("tenant_id","tabela_id","servico_id");