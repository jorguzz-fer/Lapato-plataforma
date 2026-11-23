CREATE TYPE "public"."cor_cassete" AS ENUM('preto', 'verde', 'azul', 'amarelo', 'marrom', 'branco');--> statement-breakpoint
CREATE TYPE "public"."fixacao_macroscopia" AS ENUM('adequada', 'parcial', 'inadequada');--> statement-breakpoint
ALTER TABLE "cassete" ADD COLUMN "cor" "cor_cassete";--> statement-breakpoint
ALTER TABLE "cassete" ADD COLUMN "compartilhado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "macroscopia" ADD COLUMN "medidas_em_conjunto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "macroscopia" ADD COLUMN "fixacao" "fixacao_macroscopia";--> statement-breakpoint
ALTER TABLE "macroscopia" ADD COLUMN "resumo_final" text;--> statement-breakpoint
ALTER TABLE "macroscopia" ADD COLUMN "resumo_salvo_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "macroscopia" ADD COLUMN "resumo_salvo_por_id" uuid;--> statement-breakpoint
ALTER TABLE "margem_macroscopica" ADD COLUMN "cor" text;--> statement-breakpoint
ALTER TABLE "macroscopia" ADD CONSTRAINT "macroscopia_resumo_salvo_por_id_usuario_id_fk" FOREIGN KEY ("resumo_salvo_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;