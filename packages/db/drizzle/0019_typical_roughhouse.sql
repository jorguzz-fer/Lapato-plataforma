CREATE TYPE "public"."tipo_marcador_corporal" AS ENUM('ferida', 'escoriacao', 'hematoma', 'incisao', 'massa', 'fratura_suspeita', 'outra');--> statement-breakpoint
CREATE TYPE "public"."vista_mapa_corporal" AS ENUM('lateral_esquerda', 'lateral_direita', 'dorsal', 'ventral');--> statement-breakpoint
CREATE TABLE "marcador_corporal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"necropsia_id" uuid NOT NULL,
	"tipo" "tipo_marcador_corporal" NOT NULL,
	"vista" "vista_mapa_corporal" NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"descricao" text,
	"lesao_id" uuid,
	"criado_por_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marcador_corporal" ADD CONSTRAINT "marcador_corporal_necropsia_id_necropsia_id_fk" FOREIGN KEY ("necropsia_id") REFERENCES "public"."necropsia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marcador_corporal" ADD CONSTRAINT "marcador_corporal_lesao_id_lesao_necroscopica_id_fk" FOREIGN KEY ("lesao_id") REFERENCES "public"."lesao_necroscopica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marcador_corporal" ADD CONSTRAINT "marcador_corporal_criado_por_id_usuario_id_fk" FOREIGN KEY ("criado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_marcador_corporal_necropsia" ON "marcador_corporal" USING btree ("tenant_id","necropsia_id");