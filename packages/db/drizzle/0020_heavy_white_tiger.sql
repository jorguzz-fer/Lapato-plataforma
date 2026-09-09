CREATE TYPE "public"."margem_cirurgica" AS ENUM('sem_margem', 'margem_simples', 'margem_identificada');--> statement-breakpoint
ALTER TABLE "amostra" ADD COLUMN "margem_cirurgica" "margem_cirurgica" DEFAULT 'sem_margem' NOT NULL;--> statement-breakpoint
ALTER TABLE "cassete" ADD COLUMN "fragmentos" integer;--> statement-breakpoint
ALTER TABLE "lesao_macroscopica" ADD COLUMN "terceiro_eixo_cm" numeric(8, 2);