ALTER TABLE "caso" ADD COLUMN "entrada_em" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Backfill: o caso que ja existia entrou quando foi cadastrado - e assim que
-- o prazo dele foi contado ate aqui. O FORCE e suspenso durante o UPDATE
-- porque, com FORCE ROW LEVEL SECURITY, ate o dono da tabela fica sujeito as
-- politicas e sem `app.current_tenant` o UPDATE atualizaria zero linhas EM
-- SILENCIO (mesma armadilha da 0008).
ALTER TABLE "caso" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "caso" SET "entrada_em" = "cadastrado_em";--> statement-breakpoint
ALTER TABLE "caso" FORCE ROW LEVEL SECURITY;
