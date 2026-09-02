CREATE TYPE "public"."modalidade_cobranca" AS ENUM('convenio', 'particular');--> statement-breakpoint
ALTER TABLE "cliente" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "cliente" ADD COLUMN "telefone" text;--> statement-breakpoint
ALTER TABLE "paciente" ADD COLUMN "raca" text;--> statement-breakpoint
ALTER TABLE "caso" ADD COLUMN "modalidade" "modalidade_cobranca" DEFAULT 'convenio' NOT NULL;--> statement-breakpoint
ALTER TABLE "caso" ADD COLUMN "clinica_origem" text;--> statement-breakpoint
ALTER TABLE "caso" ADD COLUMN "veterinario_informado" text;--> statement-breakpoint
-- Review: "deixar só Histopatologia". O nome do servico ja cadastrado muda
-- junto com o seed. FORCE suspenso durante o UPDATE pela armadilha da 0008:
-- com FORCE ROW LEVEL SECURITY ate o dono fica sujeito as politicas e, sem
-- `app.current_tenant`, o UPDATE atualizaria zero linhas em silencio.
ALTER TABLE "servico" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "servico" SET "nome" = 'Histopatologia' WHERE "nome" = 'Histopatologia de biópsia';--> statement-breakpoint
ALTER TABLE "servico" FORCE ROW LEVEL SECURITY;
