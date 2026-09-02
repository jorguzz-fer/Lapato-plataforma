CREATE TABLE "convite_cadastro_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"criado_por_id" uuid,
	"dados_anteriores" jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "convite_cadastro_cliente_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "convite_cadastro_cliente" ADD CONSTRAINT "convite_cadastro_cliente_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_convite_cadastro_cliente" ON "convite_cadastro_cliente" USING btree ("tenant_id","cliente_id");--> statement-breakpoint
CREATE INDEX "idx_convite_cadastro_token" ON "convite_cadastro_cliente" USING btree ("token_hash");