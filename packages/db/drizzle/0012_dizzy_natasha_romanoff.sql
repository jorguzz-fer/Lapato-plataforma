CREATE TABLE "item_tabela_preco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tabela_id" uuid NOT NULL,
	"servico_id" uuid NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_item_tabela_preco" UNIQUE("tenant_id","tabela_id","servico_id")
);
--> statement-breakpoint
CREATE TABLE "tabela_preco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_tabela_preco_nome" UNIQUE("tenant_id","nome")
);
--> statement-breakpoint
ALTER TABLE "cliente" ADD COLUMN "tabela_preco_id" uuid;--> statement-breakpoint
ALTER TABLE "item_tabela_preco" ADD CONSTRAINT "item_tabela_preco_tabela_id_tabela_preco_id_fk" FOREIGN KEY ("tabela_id") REFERENCES "public"."tabela_preco"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tabela_preco" ADD CONSTRAINT "item_tabela_preco_servico_id_servico_id_fk" FOREIGN KEY ("servico_id") REFERENCES "public"."servico"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_item_tabela_preco" ON "item_tabela_preco" USING btree ("tenant_id","tabela_id");--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_tabela_preco_id_tabela_preco_id_fk" FOREIGN KEY ("tabela_preco_id") REFERENCES "public"."tabela_preco"("id") ON DELETE set null ON UPDATE no action;