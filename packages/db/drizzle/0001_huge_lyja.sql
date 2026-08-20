ALTER TABLE "usuario" ADD COLUMN "senha_troca_obrigatoria" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "senha_alterada_em" timestamp with time zone;