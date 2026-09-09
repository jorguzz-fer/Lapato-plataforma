CREATE TABLE "modelo_macroscopia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"orgao" text NOT NULL,
	"titulo" text NOT NULL,
	"texto" text NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid
);
--> statement-breakpoint
ALTER TABLE "lesao_macroscopica" ADD COLUMN "descricao_texto" text;--> statement-breakpoint
ALTER TABLE "margem_macroscopica" ADD COLUMN "lesao_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_modelo_macroscopia_orgao" ON "modelo_macroscopia" USING btree ("tenant_id","orgao");--> statement-breakpoint
ALTER TABLE "margem_macroscopica" ADD CONSTRAINT "margem_macroscopica_lesao_id_lesao_macroscopica_id_fk" FOREIGN KEY ("lesao_id") REFERENCES "public"."lesao_macroscopica"("id") ON DELETE no action ON UPDATE no action;