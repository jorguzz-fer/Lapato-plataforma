CREATE TABLE "envio_laudo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"laudo_id" uuid NOT NULL,
	"versao_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"canal" text DEFAULT 'email' NOT NULL,
	"destinatarios" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reenvio" boolean DEFAULT false NOT NULL,
	"observacao" text,
	"enviado_por_id" uuid,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "envio_laudo" ADD CONSTRAINT "envio_laudo_laudo_id_laudo_id_fk" FOREIGN KEY ("laudo_id") REFERENCES "public"."laudo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envio_laudo" ADD CONSTRAINT "envio_laudo_versao_id_laudo_versao_id_fk" FOREIGN KEY ("versao_id") REFERENCES "public"."laudo_versao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envio_laudo" ADD CONSTRAINT "envio_laudo_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envio_laudo" ADD CONSTRAINT "envio_laudo_enviado_por_id_usuario_id_fk" FOREIGN KEY ("enviado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_envio_laudo_laudo" ON "envio_laudo" USING btree ("tenant_id","laudo_id");--> statement-breakpoint
CREATE INDEX "idx_envio_laudo_caso" ON "envio_laudo" USING btree ("tenant_id","caso_id");