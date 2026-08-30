ALTER TYPE "public"."tipo_imagem" ADD VALUE 'requisicao';--> statement-breakpoint
ALTER TABLE "servico" ALTER COLUMN "exige_triagem" SET DEFAULT false;--> statement-breakpoint
-- Decisao da primeira review com o laboratorio: a triagem deixa de ser etapa
-- obrigatoria do fluxo. A etapa continua definida no workflow e volta quando o
-- servico religa a flag na Administracao.
--
-- O FORCE e suspenso durante o UPDATE porque, com FORCE ROW LEVEL SECURITY,
-- ate o dono da tabela fica sujeito as policies - e sem `app.current_tenant`
-- definido o UPDATE atualizaria zero linhas EM SILENCIO. A mudanca e de todas
-- as instituicoes por definicao, entao aqui a RLS nao tem o que proteger.
ALTER TABLE "servico" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "servico" SET "exige_triagem" = false;--> statement-breakpoint
ALTER TABLE "servico" FORCE ROW LEVEL SECURITY;
