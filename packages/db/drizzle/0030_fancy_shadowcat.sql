ALTER TABLE "exame_orgao" ADD COLUMN "amostra_coletada" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exame_orgao" ADD COLUMN "amostra_observacao" text;--> statement-breakpoint
ALTER TABLE "necropsia" ADD COLUMN "observacao_tutor" text;--> statement-breakpoint
ALTER TABLE "necropsia" ADD COLUMN "ciente_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "necropsia" ADD COLUMN "ciente_por_id" uuid;--> statement-breakpoint
ALTER TABLE "necropsia" ADD COLUMN "exame_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "necropsia" ADD CONSTRAINT "necropsia_ciente_por_id_usuario_id_fk" FOREIGN KEY ("ciente_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;