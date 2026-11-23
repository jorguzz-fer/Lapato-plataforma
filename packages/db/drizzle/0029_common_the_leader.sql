CREATE TABLE "formulario_necropsia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"necropsia_id" uuid NOT NULL,
	"token_hash" text,
	"expira_em" timestamp with time zone,
	"respondido_em" timestamp with time zone,
	"respondido_por" text,
	"canal_envio" text,
	"enviado_em" timestamp with time zone,
	"enviado_por_id" uuid,
	"respostas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "formulario_necropsia_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "necropsia" ADD COLUMN "devolucao_corpo" boolean;--> statement-breakpoint
ALTER TABLE "necropsia" ADD COLUMN "valor_combinado" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "necropsia" ADD COLUMN "responsavel_documento" text;--> statement-breakpoint
ALTER TABLE "necropsia" ADD COLUMN "responsavel_cidade" text;--> statement-breakpoint
ALTER TABLE "necropsia" ADD COLUMN "responsavel_uf" text;--> statement-breakpoint
ALTER TABLE "formulario_necropsia" ADD CONSTRAINT "formulario_necropsia_necropsia_id_necropsia_id_fk" FOREIGN KEY ("necropsia_id") REFERENCES "public"."necropsia"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulario_necropsia" ADD CONSTRAINT "formulario_necropsia_enviado_por_id_usuario_id_fk" FOREIGN KEY ("enviado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_formulario_necropsia" ON "formulario_necropsia" USING btree ("tenant_id","necropsia_id");--> statement-breakpoint
CREATE INDEX "idx_formulario_necropsia_token" ON "formulario_necropsia" USING btree ("token_hash");