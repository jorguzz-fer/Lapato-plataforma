ALTER TABLE "servico" ADD COLUMN "alerta_atencao_horas" integer;--> statement-breakpoint
ALTER TABLE "servico" ADD COLUMN "alerta_critico_horas" integer;--> statement-breakpoint
-- Limiares de cor para quem JA esta rodando, pelos valores que o Hugo opera
-- hoje no mapa de exames dele: citologia em horas (24 e 48), histopatologia em
-- dias (tres e cinco). Servico que o laboratorio criou por conta propria fica
-- nulo e segue contando pelos dias uteis restantes.
--
-- FORCE suspenso durante o UPDATE pela armadilha da 0008: com FORCE ROW LEVEL
-- SECURITY ate o dono fica sujeito as politicas e, sem `app.current_tenant`, o
-- UPDATE atualizaria zero linhas em silencio.
ALTER TABLE "servico" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "servico" SET "alerta_atencao_horas" = 72, "alerta_critico_horas" = 120
  WHERE "modalidade" = 'histopatologia'
    AND "alerta_atencao_horas" IS NULL AND "alerta_critico_horas" IS NULL;--> statement-breakpoint
UPDATE "servico" SET "alerta_atencao_horas" = 24, "alerta_critico_horas" = 48
  WHERE "modalidade" IN ('citopatologia', 'revisao')
    AND "alerta_atencao_horas" IS NULL AND "alerta_critico_horas" IS NULL;--> statement-breakpoint
ALTER TABLE "servico" FORCE ROW LEVEL SECURITY;
