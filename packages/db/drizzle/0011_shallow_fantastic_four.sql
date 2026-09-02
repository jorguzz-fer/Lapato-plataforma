ALTER TABLE "item_ordem_servico" ADD COLUMN "retrabalho" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD COLUMN "faturavel_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD COLUMN "faturavel_origem" text;