CREATE TYPE "public"."alerta_prazo" AS ENUM('normal', 'atencao', 'critico', 'atrasado');--> statement-breakpoint
CREATE TYPE "public"."categoria_usuario" AS ENUM('interno', 'externo', 'academico', 'temporario');--> statement-breakpoint
CREATE TYPE "public"."etapa" AS ENUM('aguardando_recebimento', 'recebido', 'aguardando_triagem', 'em_triagem', 'aguardando_macroscopia', 'em_macroscopia', 'aguardando_processamento', 'em_processamento', 'laminas_disponiveis', 'aguardando_microscopia', 'em_microscopia', 'aguardando_complementar', 'aguardando_revisao', 'em_revisao', 'aguardando_assinatura', 'liberado', 'arquivado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."forma_entrega" AS ENUM('entrega_balcao', 'coleta_propria', 'transportadora', 'correios', 'motoboy', 'outra');--> statement-breakpoint
CREATE TYPE "public"."gravidade_nc" AS ENUM('leve', 'moderada', 'grave', 'critica');--> statement-breakpoint
CREATE TYPE "public"."lateralidade" AS ENUM('direito', 'esquerdo', 'bilateral', 'nao_aplicavel');--> statement-breakpoint
CREATE TYPE "public"."metodo_amostragem" AS ENUM('perpendicular', 'tangencial_en_face', 'radial');--> statement-breakpoint
CREATE TYPE "public"."nivel_bloqueio" AS ENUM('nao', 'parcial', 'total');--> statement-breakpoint
CREATE TYPE "public"."nivel_ia" AS ENUM('informacao', 'sugestao', 'atencao', 'critico');--> statement-breakpoint
CREATE TYPE "public"."nivel_imagem" AS ENUM('original', 'trabalho', 'publicada');--> statement-breakpoint
CREATE TYPE "public"."origem_imagem" AS ENUM('produzida_lapato', 'enviada_cliente', 'enviada_veterinario', 'importada', 'laboratorio_parceiro', 'pericial_externa');--> statement-breakpoint
CREATE TYPE "public"."prioridade" AS ENUM('rotina', 'prioritaria', 'urgente', 'critica');--> statement-breakpoint
CREATE TYPE "public"."resultado_margem" AS ENUM('livre', 'comprometida', 'proxima', 'nao_avaliavel', 'indeterminada');--> statement-breakpoint
CREATE TYPE "public"."resultado_triagem" AS ENUM('apto', 'apto_com_ressalva', 'bloqueado', 'recusado');--> statement-breakpoint
CREATE TYPE "public"."status_cliente" AS ENUM('ativo', 'aguardando_aprovacao', 'pendente_documentacao', 'suspenso', 'inativo', 'bloqueado', 'encerrado');--> statement-breakpoint
CREATE TYPE "public"."status_laudo" AS ENUM('rascunho', 'aguardando_revisao', 'em_revisao', 'retornado_para_correcao', 'aguardando_assinatura', 'assinado', 'liberado', 'substituido');--> statement-breakpoint
CREATE TYPE "public"."status_pendencia" AS ENUM('aberta', 'aguardando_acao_interna', 'aguardando_cliente', 'aguardando_veterinario', 'aguardando_patologista', 'aguardando_autorizacao', 'aguardando_execucao_tecnica', 'respondida', 'em_validacao', 'resolvida', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."status_solicitacao" AS ENUM('criada', 'aguardando_analise', 'aprovada', 'recusada', 'aguardando_execucao', 'em_execucao', 'aguardando_informacao', 'parcialmente_concluida', 'concluida', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."status_usuario" AS ENUM('ativo', 'aguardando_ativacao', 'suspenso', 'bloqueado', 'afastado', 'temporario', 'acesso_expirado', 'desligado', 'inativo');--> statement-breakpoint
CREATE TYPE "public"."tipo_cliente" AS ENUM('clinica', 'hospital', 'veterinario_autonomo', 'laboratorio_parceiro', 'universidade', 'instituicao_publica', 'ong', 'centro_pesquisa', 'empresa', 'tutor_particular', 'outro');--> statement-breakpoint
CREATE TYPE "public"."tipo_imagem" AS ENUM('recebimento', 'triagem', 'macroscopia', 'microfotografia', 'necropsia', 'documento', 'whole_slide');--> statement-breakpoint
CREATE TYPE "public"."tipo_unidade" AS ENUM('sede', 'filial', 'posto_recebimento', 'laboratorio_apoio', 'unidade_parceira');--> statement-breakpoint
CREATE TYPE "public"."tipo_versao_laudo" AS ENUM('original', 'adendo', 'correcao');--> statement-breakpoint
CREATE TYPE "public"."visibilidade_evento" AS ENUM('interno', 'externo', 'restrito', 'pericial', 'administrativo');--> statement-breakpoint
CREATE TABLE "local_fisico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unidade_id" uuid NOT NULL,
	"setor_id" uuid,
	"pai_id" uuid,
	"nome" text NOT NULL,
	"codigo" text NOT NULL,
	"categoria" text NOT NULL,
	"capacidade" integer,
	"condicao_ambiental" text,
	"restricao_acesso" text,
	"status" text DEFAULT 'operacional' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_local_codigo" UNIQUE("tenant_id","codigo")
);
--> statement-breakpoint
CREATE TABLE "setor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unidade_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"codigo" text NOT NULL,
	"tipo" text NOT NULL,
	"responsavel_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_setor_codigo" UNIQUE("tenant_id","unidade_id","codigo")
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"razao_social" text NOT NULL,
	"nome_fantasia" text NOT NULL,
	"cnpj" text,
	"preferencias" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"identidade_visual" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "unidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"codigo" text NOT NULL,
	"sigla" text,
	"tipo" "tipo_unidade" NOT NULL,
	"endereco" jsonb,
	"contatos" jsonb,
	"responsavel" text,
	"horario_funcionamento" jsonb,
	"configuracao_especifica" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_unidade_codigo" UNIQUE("tenant_id","codigo")
);
--> statement-breakpoint
CREATE TABLE "assinatura_profissional" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"tipo" text DEFAULT 'eletronica' NOT NULL,
	"identificacao_profissional" text NOT NULL,
	"representacao_grafica" text,
	"valido_de" timestamp with time zone DEFAULT now() NOT NULL,
	"valido_ate" timestamp with time zone,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perfil" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"chave" text,
	"descricao" text,
	"exige_supervisao" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_perfil_nome" UNIQUE("tenant_id","nome")
);
--> statement-breakpoint
CREATE TABLE "perfil_permissao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"perfil_id" uuid NOT NULL,
	"permissao" text NOT NULL,
	"escopo" text DEFAULT 'unidade' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_perfil_permissao" UNIQUE("perfil_id","permissao")
);
--> statement-breakpoint
CREATE TABLE "permissao_individual" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"permissao" text NOT NULL,
	"concedida" boolean NOT NULL,
	"escopo" text DEFAULT 'unidade' NOT NULL,
	"valido_ate" timestamp with time zone,
	"motivo" text,
	"concedido_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_permissao_individual" UNIQUE("usuario_id","permissao")
);
--> statement-breakpoint
CREATE TABLE "sessao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"unidade_ativa_id" uuid,
	"ip" text,
	"user_agent" text,
	"expira_em" timestamp with time zone NOT NULL,
	"revogada_em" timestamp with time zone,
	"ultimo_uso_em" timestamp with time zone DEFAULT now() NOT NULL,
	"mfa_validado" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessao_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome_completo" text NOT NULL,
	"nome_exibicao" text,
	"email" text NOT NULL,
	"cpf" text,
	"telefone" text,
	"senha_hash" text,
	"mfa_segredo" text,
	"mfa_ativo" boolean DEFAULT false NOT NULL,
	"status" "status_usuario" DEFAULT 'aguardando_ativacao' NOT NULL,
	"categoria" "categoria_usuario" DEFAULT 'interno' NOT NULL,
	"dados_profissionais" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unidade_principal_id" uuid,
	"setor_principal_id" uuid,
	"acesso_expira_em" timestamp with time zone,
	"ultimo_acesso_em" timestamp with time zone,
	"tentativas_falhas" jsonb DEFAULT '{"contador":0,"bloqueadoAte":null}'::jsonb NOT NULL,
	"cliente_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_usuario_email" UNIQUE("tenant_id","email")
);
--> statement-breakpoint
CREATE TABLE "usuario_perfil" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"perfil_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_usuario_perfil" UNIQUE("usuario_id","perfil_id")
);
--> statement-breakpoint
CREATE TABLE "usuario_unidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"unidade_id" uuid NOT NULL,
	"nivel_acesso" text DEFAULT 'total' NOT NULL,
	"valido_ate" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_usuario_unidade" UNIQUE("usuario_id","unidade_id")
);
--> statement-breakpoint
CREATE TABLE "dia_nao_util" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unidade_id" uuid,
	"data" date NOT NULL,
	"descricao" text NOT NULL,
	"tipo" text DEFAULT 'institucional' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_dia_nao_util" UNIQUE("tenant_id","unidade_id","data")
);
--> statement-breakpoint
CREATE TABLE "modelo_etiqueta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"alvo" text NOT NULL,
	"largura_mm" integer NOT NULL,
	"altura_mm" integer NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"copias_padrao" integer DEFAULT 1 NOT NULL,
	"impressora_padrao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_modelo_etiqueta" UNIQUE("tenant_id","nome")
);
--> statement-breakpoint
CREATE TABLE "sequencia_numeracao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"escopo" text NOT NULL,
	"ano" integer NOT NULL,
	"discriminador" text DEFAULT '' NOT NULL,
	"proximo_valor" integer DEFAULT 1 NOT NULL,
	"mascara" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sequencia" UNIQUE("tenant_id","escopo","ano","discriminador")
);
--> statement-breakpoint
CREATE TABLE "servico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"codigo" text NOT NULL,
	"categoria" text NOT NULL,
	"descricao" text,
	"modalidade" text NOT NULL,
	"exige_triagem" boolean DEFAULT true NOT NULL,
	"exige_macroscopia" boolean DEFAULT false NOT NULL,
	"exige_processamento" boolean DEFAULT false NOT NULL,
	"exige_microscopia" boolean DEFAULT true NOT NULL,
	"gera_laudo" boolean DEFAULT true NOT NULL,
	"permite_complementares" boolean DEFAULT true NOT NULL,
	"gera_material_bioteca" boolean DEFAULT false NOT NULL,
	"disponivel_portal" boolean DEFAULT true NOT NULL,
	"prazo_dias_uteis" integer DEFAULT 5 NOT NULL,
	"prazo_urgente_dias_uteis" integer,
	"caracteristicas_operacionais" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_servico_codigo" UNIQUE("tenant_id","codigo")
);
--> statement-breakpoint
CREATE TABLE "tabela_mestre" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"chave" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"sistema" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_tabela_mestre_chave" UNIQUE("tenant_id","chave")
);
--> statement-breakpoint
CREATE TABLE "termo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tabela_id" uuid NOT NULL,
	"valor" text NOT NULL,
	"codigo" text NOT NULL,
	"pai_id" uuid,
	"sinonimos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"abreviacao" text,
	"ordem" integer DEFAULT 0 NOT NULL,
	"metadados" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_termo_codigo" UNIQUE("tenant_id","tabela_id","codigo")
);
--> statement-breakpoint
CREATE TABLE "versao_configuracao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" uuid NOT NULL,
	"versao" integer NOT NULL,
	"conteudo" jsonb NOT NULL,
	"vigencia_inicio" timestamp with time zone DEFAULT now() NOT NULL,
	"vigencia_fim" timestamp with time zone,
	"responsavel_id" uuid,
	"justificativa" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_versao_config" UNIQUE("tenant_id","entidade","entidade_id","versao")
);
--> statement-breakpoint
CREATE TABLE "cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome_fantasia" text NOT NULL,
	"razao_social" text,
	"documento" text,
	"tipo" "tipo_cliente" NOT NULL,
	"status" "status_cliente" DEFAULT 'ativo' NOT NULL,
	"codigo" text NOT NULL,
	"nome_abreviado" text,
	"origem" text DEFAULT 'interno' NOT NULL,
	"fundido_em_id" uuid,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_cliente_codigo" UNIQUE("tenant_id","codigo")
);
--> statement-breakpoint
CREATE TABLE "cliente_contato" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"cargo" text,
	"email" text,
	"telefone" text,
	"whatsapp" text,
	"canal_preferencial" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cliente_endereco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"cep" text,
	"logradouro" text,
	"numero" text,
	"complemento" text,
	"bairro" text,
	"municipio" text,
	"estado" text,
	"pais" text DEFAULT 'BR' NOT NULL,
	"padrao_coleta" boolean DEFAULT false NOT NULL,
	"padrao_faturamento" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paciente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tutor_id" uuid,
	"especie_id" uuid,
	"raca_id" uuid,
	"sexo" text,
	"condicao_reprodutiva" text,
	"data_nascimento" date,
	"idade_informada" text,
	"pelagem" text,
	"microchip" text,
	"identificacao_alternativa" text,
	"obito" boolean DEFAULT false NOT NULL,
	"data_obito" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "tutor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"documento" text,
	"email" text,
	"telefone" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "veterinario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"crmv" text,
	"crmv_uf" text,
	"email" text,
	"telefone" text,
	"especialidade" text,
	"crmv_conferido_em" date,
	"status" text DEFAULT 'ativo' NOT NULL,
	"fundido_em_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inativado_em" timestamp with time zone,
	"inativado_por" uuid,
	CONSTRAINT "uq_veterinario_crmv" UNIQUE("tenant_id","crmv","crmv_uf")
);
--> statement-breakpoint
CREATE TABLE "vinculo_veterinario_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"veterinario_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"cargo" text,
	"principal" boolean DEFAULT false NOT NULL,
	"recebe_laudo" boolean DEFAULT true NOT NULL,
	"recebe_notificacoes" boolean DEFAULT true NOT NULL,
	"pode_solicitar_exames" boolean DEFAULT true NOT NULL,
	"inicio_em" date,
	"termino_em" date,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_vinculo_vet_cliente" UNIQUE("veterinario_id","cliente_id")
);
--> statement-breakpoint
CREATE TABLE "amostra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"recipiente_id" uuid,
	"identificador" text NOT NULL,
	"ordem" integer NOT NULL,
	"letra" text NOT NULL,
	"descricao" text,
	"orgao_id" uuid,
	"tecido_id" uuid,
	"regiao_anatomica" text,
	"lateralidade" "lateralidade" DEFAULT 'nao_aplicavel' NOT NULL,
	"tipo_relacao" text,
	"metodo_coleta" text,
	"resultado_triagem" "resultado_triagem",
	"triagem_observacoes" text,
	"material_totalmente_incluido" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_amostra_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "caso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"sequencial" integer NOT NULL,
	"ano" integer NOT NULL,
	"unidade_id" uuid NOT NULL,
	"servico_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"veterinario_id" uuid,
	"paciente_id" uuid NOT NULL,
	"remessa_id" uuid,
	"prioridade" "prioridade" DEFAULT 'rotina' NOT NULL,
	"solicitado_em" timestamp with time zone,
	"cadastrado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"cadastrado_por_id" uuid,
	"recebido_em" timestamp with time zone,
	"recebido_por_id" uuid,
	"triado_em" timestamp with time zone,
	"triado_por_id" uuid,
	"resultado_triagem" "resultado_triagem",
	"caso_anterior_id" uuid,
	"tipo_relacao_anterior" text,
	"patologista_responsavel_id" uuid,
	"pericial" boolean DEFAULT false NOT NULL,
	"cancelado_em" timestamp with time zone,
	"motivo_cancelamento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_caso_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "historico_clinico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"texto" text NOT NULL,
	"estruturado" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origem" text NOT NULL,
	"complementar" boolean DEFAULT false NOT NULL,
	"registrado_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nao_conformidade_pre_analitica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"amostra_id" uuid,
	"recipiente_id" uuid,
	"tipo" text NOT NULL,
	"gravidade" "gravidade_nc" NOT NULL,
	"descricao" text NOT NULL,
	"impacto_potencial" text,
	"acao_corretiva" text,
	"acao_corretiva_em" timestamp with time zone,
	"registrada_por_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipiente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"ordem" integer NOT NULL,
	"tipo_id" uuid,
	"fixador_id" uuid,
	"identificacao_externa" text,
	"quantidade_declarada" integer,
	"quantidade_recebida" integer,
	"recebido_em" timestamp with time zone,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_recipiente_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "remessa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"cliente_id" uuid,
	"unidade_id" uuid NOT NULL,
	"forma_entrega" "forma_entrega" NOT NULL,
	"recebida_em" timestamp with time zone DEFAULT now() NOT NULL,
	"recebida_por_id" uuid,
	"condicoes_transporte" jsonb,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_remessa_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "triagem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"amostra_id" uuid,
	"resultado" "resultado_triagem" NOT NULL,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observacoes" text,
	"iniciada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluida_em" timestamp with time zone,
	"executada_por_id" uuid NOT NULL,
	"setor_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bloqueio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"amostra_id" uuid,
	"nivel" "nivel_bloqueio" NOT NULL,
	"origem" text NOT NULL,
	"origem_id" uuid,
	"motivo" text NOT NULL,
	"etapa_bloqueada" "etapa",
	"condicao_liberacao" text,
	"criado_por_id" uuid,
	"liberado_em" timestamp with time zone,
	"liberado_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "definicao_workflow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"servico_id" uuid,
	"modalidade" text NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workflow_nome_versao" UNIQUE("tenant_id","nome","versao")
);
--> statement-breakpoint
CREATE TABLE "estado_amostra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"amostra_id" uuid NOT NULL,
	"etapa" "etapa" NOT NULL,
	"entrou_na_etapa_em" timestamp with time zone DEFAULT now() NOT NULL,
	"bloqueada" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estado_amostra_amostra_id_unique" UNIQUE("amostra_id")
);
--> statement-breakpoint
CREATE TABLE "estado_caso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"workflow_id" uuid,
	"etapa" "etapa" NOT NULL,
	"detalhe" text,
	"entrou_na_etapa_em" timestamp with time zone DEFAULT now() NOT NULL,
	"responsavel_id" uuid,
	"setor_tipo" text,
	"prazo_dias_uteis" integer,
	"prazo_iniciado_em" timestamp with time zone,
	"previsao_liberacao" timestamp with time zone,
	"alerta_prazo" "alerta_prazo" DEFAULT 'normal' NOT NULL,
	"bloqueado" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estado_caso_caso_id_unique" UNIQUE("caso_id")
);
--> statement-breakpoint
CREATE TABLE "etapa_workflow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"etapa" "etapa" NOT NULL,
	"ordem" integer NOT NULL,
	"obrigatoriedade" text DEFAULT 'obrigatoria' NOT NULL,
	"condicao" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"eventos_entrada" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"eventos_saida" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"setor_tipo" text,
	"limite_permanencia_horas" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_etapa_workflow" UNIQUE("workflow_id","etapa")
);
--> statement-breakpoint
CREATE TABLE "suspensao_prazo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"motivo" text NOT NULL,
	"origem" text NOT NULL,
	"origem_id" uuid,
	"inicio_em" timestamp with time zone DEFAULT now() NOT NULL,
	"fim_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evento_dominio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"caso_id" uuid,
	"modulo_origem" text NOT NULL,
	"usuario_id" uuid,
	"unidade_id" uuid,
	"setor_id" uuid,
	"objeto_tipo" text,
	"objeto_id" uuid,
	"visibilidade" "visibilidade_evento" DEFAULT 'interno' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ocorrido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificacao_pendente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"evento_id" uuid,
	"caso_id" uuid,
	"canal" text NOT NULL,
	"destinatario_tipo" text NOT NULL,
	"destinatario_id" uuid,
	"destinatario_endereco" text,
	"assunto" text,
	"corpo" text,
	"status" text DEFAULT 'pendente' NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"ultimo_erro" text,
	"enviada_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"evento_id" uuid NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"proxima_tentativa_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_erro" text,
	"processado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" uuid NOT NULL,
	"acao" text NOT NULL,
	"usuario_id" uuid,
	"unidade_id" uuid,
	"caso_id" uuid,
	"valor_anterior" jsonb,
	"valor_novo" jsonb,
	"justificativa" text,
	"apos_validacao" text,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cassete" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"amostra_id" uuid NOT NULL,
	"macroscopia_id" uuid,
	"lesao_id" uuid,
	"margem_id" uuid,
	"identificador" text NOT NULL,
	"ordem" integer NOT NULL,
	"tecido_origem" text NOT NULL,
	"descricao" text,
	"exige_descalcificacao" boolean DEFAULT false NOT NULL,
	"instrucoes_especiais" text,
	"status_tecnico" text DEFAULT 'aguardando_processamento' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cassete_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "lesao_macroscopica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"macroscopia_id" uuid NOT NULL,
	"rotulo" text NOT NULL,
	"tipo" text,
	"localizacao" text,
	"lateralidade" "lateralidade" DEFAULT 'nao_aplicavel' NOT NULL,
	"maior_eixo_cm" numeric(8, 2),
	"menor_eixo_cm" numeric(8, 2),
	"delimitacao" text,
	"distribuicao" text,
	"numero" text,
	"caracteristicas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lesao_rotulo" UNIQUE("macroscopia_id","rotulo")
);
--> statement-breakpoint
CREATE TABLE "macroscopia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"amostra_id" uuid NOT NULL,
	"caracteristicas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"descricao_texto" text,
	"comprimento_cm" numeric(8, 2),
	"largura_cm" numeric(8, 2),
	"altura_cm" numeric(8, 2),
	"peso_g" numeric(10, 2),
	"orientacao_peca" jsonb,
	"croqui" jsonb,
	"material_totalmente_incluido" boolean DEFAULT false NOT NULL,
	"material_remanescente" text,
	"iniciada_em" timestamp with time zone,
	"concluida_em" timestamp with time zone,
	"executada_por_id" uuid,
	"aprovada_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "macroscopia_amostra_id_unique" UNIQUE("amostra_id")
);
--> statement-breakpoint
CREATE TABLE "margem_macroscopica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"macroscopia_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tipo" text,
	"metodo_amostragem" "metodo_amostragem",
	"distancia_cm" numeric(8, 2),
	"tinta" jsonb,
	"nao_avaliavel" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_margem_macro_nome" UNIQUE("macroscopia_id","nome")
);
--> statement-breakpoint
CREATE TABLE "bloco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"cassete_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"bloco_origem_id" uuid,
	"esgotado" boolean DEFAULT false NOT NULL,
	"parcialmente_consumido" boolean DEFAULT false NOT NULL,
	"local_arquivo_id" uuid,
	"produzido_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_bloco_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "divergencia_cassete" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lote_id" uuid NOT NULL,
	"cassete_id" uuid,
	"tipo" text NOT NULL,
	"codigo_informado" text,
	"descricao" text NOT NULL,
	"apontada_por_id" uuid,
	"resolvida_em" timestamp with time zone,
	"resolucao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lamina" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"bloco_id" uuid,
	"identificador" text NOT NULL,
	"coloracao_id" uuid,
	"coloracao_sigla" text NOT NULL,
	"nivel" integer DEFAULT 1 NOT NULL,
	"repeticao" boolean DEFAULT false NOT NULL,
	"motivo_repeticao" text,
	"disponivel_em" timestamp with time zone,
	"produzida_por_id" uuid,
	"controle_coloracao" jsonb,
	"local_arquivo_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lamina_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "lote_cassete" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lote_id" uuid NOT NULL,
	"cassete_id" uuid NOT NULL,
	"confirmado_recebimento" boolean,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lote_cassete" UNIQUE("lote_id","cassete_id")
);
--> statement-breakpoint
CREATE TABLE "lote_envio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"data_envio" date NOT NULL,
	"laboratorio_apoio_id" uuid,
	"enviado_em" timestamp with time zone,
	"enviado_por_id" uuid,
	"recebido_parceiro_em" timestamp with time zone,
	"recebido_parceiro_por_id" uuid,
	"status" text DEFAULT 'aberto' NOT NULL,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lote_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "mensagem_solicitacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"solicitacao_id" uuid,
	"pendencia_id" uuid,
	"autor_id" uuid,
	"texto" text NOT NULL,
	"externa" boolean DEFAULT false NOT NULL,
	"anexos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pendencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"solicitacao_id" uuid,
	"tipo" text NOT NULL,
	"descricao" text NOT NULL,
	"status" "status_pendencia" DEFAULT 'aberta' NOT NULL,
	"nivel_bloqueio" "nivel_bloqueio" DEFAULT 'nao' NOT NULL,
	"etapa_bloqueada" "etapa",
	"objeto_tipo" text,
	"objeto_id" uuid,
	"suspende_prazo" boolean DEFAULT false NOT NULL,
	"responsavel_id" uuid,
	"setor_responsavel" text,
	"visivel_portal" boolean DEFAULT false NOT NULL,
	"criada_por_id" uuid,
	"criada_por_sistema" text,
	"resolvida_em" timestamp with time zone,
	"resolvida_por_id" uuid,
	"resolucao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solicitacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"caso_id" uuid,
	"tipo" text NOT NULL,
	"categoria" text,
	"origem" text DEFAULT 'interna' NOT NULL,
	"descricao" text NOT NULL,
	"justificativa" text,
	"prioridade" "prioridade" DEFAULT 'rotina' NOT NULL,
	"status" "status_solicitacao" DEFAULT 'criada' NOT NULL,
	"objeto_tipo" text,
	"objeto_id" uuid,
	"solicitante_por_id" uuid,
	"solicitante_sistema" text,
	"responsavel_id" uuid,
	"setor_responsavel" text,
	"prazo_em" timestamp with time zone,
	"visibilidade_portal" text DEFAULT 'nao' NOT NULL,
	"texto_portal" text,
	"exige_aprovacao" boolean DEFAULT false NOT NULL,
	"aprovada_por_id" uuid,
	"aprovada_em" timestamp with time zone,
	"motivo_recusa" text,
	"concluida_em" timestamp with time zone,
	"concluida_por_id" uuid,
	"resultado_tecnico" text,
	"cancelada_em" timestamp with time zone,
	"motivo_cancelamento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_solicitacao_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "contagem_mitotica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"laudo_versao_id" uuid NOT NULL,
	"lamina_id" uuid,
	"mitoses" integer NOT NULL,
	"area_mm2" numeric(8, 4) NOT NULL,
	"numero_campos" integer,
	"diametro_campo_mm" numeric(6, 4),
	"equipamento" text,
	"regiao_selecionada" text,
	"mitoses_atipicas" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"laudo_versao_id" uuid NOT NULL,
	"amostra_id" uuid,
	"ordem" integer DEFAULT 0 NOT NULL,
	"hierarquia" text DEFAULT 'principal' NOT NULL,
	"orgao_id" uuid,
	"processo" text,
	"entidade" text,
	"comportamento" text,
	"distribuicao" text,
	"severidade" text,
	"duracao" text,
	"qualificadores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lateralidade" "lateralidade" DEFAULT 'nao_aplicavel' NOT NULL,
	"texto_exibido" text NOT NULL,
	"classificacao_nome" text,
	"classificacao_versao" text,
	"grau" text,
	"criterios_graduacao" jsonb,
	"diferenciais" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provisorio" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "laudo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid NOT NULL,
	"status" "status_laudo" DEFAULT 'rascunho' NOT NULL,
	"versao_atual" integer DEFAULT 1 NOT NULL,
	"patologista_id" uuid,
	"revisor_id" uuid,
	"liberado_em" timestamp with time zone,
	"primeira_liberacao_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laudo_caso_id_unique" UNIQUE("caso_id")
);
--> statement-breakpoint
CREATE TABLE "laudo_versao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"laudo_id" uuid NOT NULL,
	"versao" integer NOT NULL,
	"tipo" "tipo_versao_laudo" DEFAULT 'original' NOT NULL,
	"conteudo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"descricao_microscopica" text,
	"comentarios" text,
	"conclusao" text,
	"nota_interna" text,
	"motivo" text,
	"criada_por_id" uuid,
	"assinada_em" timestamp with time zone,
	"assinada_por_id" uuid,
	"assinatura_identificacao" text,
	"assinatura_mecanismo" text,
	"pdf_chave" text,
	"pdf_hash" text,
	"codigo_validacao" text,
	"substituida" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_laudo_versao" UNIQUE("laudo_id","versao")
);
--> statement-breakpoint
CREATE TABLE "margem_microscopica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"laudo_versao_id" uuid NOT NULL,
	"margem_macro_id" uuid,
	"nome" text NOT NULL,
	"resultado" "resultado_margem" NOT NULL,
	"distancia_mm" numeric(8, 2),
	"tipo_extensao" text,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_margem_micro_nome" UNIQUE("laudo_versao_id","nome")
);
--> statement-breakpoint
CREATE TABLE "revisao_laudo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"laudo_versao_id" uuid NOT NULL,
	"revisor_id" uuid NOT NULL,
	"resultado" text NOT NULL,
	"comentarios" text,
	"discordancia" boolean DEFAULT false NOT NULL,
	"concluida_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imagem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"caso_id" uuid,
	"tipo" "tipo_imagem" NOT NULL,
	"origem" "origem_imagem" NOT NULL,
	"modulo_contexto" text NOT NULL,
	"objeto_tipo" text,
	"objeto_id" uuid,
	"metadados" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"legenda" text,
	"descricao" text,
	"capturada_em" timestamp with time zone,
	"enviada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"autor_id" uuid,
	"incluida_no_laudo" boolean DEFAULT false NOT NULL,
	"ordem_no_laudo" integer,
	"autorizada_ensino" boolean DEFAULT false NOT NULL,
	"autorizada_pesquisa" boolean DEFAULT false NOT NULL,
	"autorizada_treinamento_ia" boolean DEFAULT false NOT NULL,
	"inativada_em" timestamp with time zone,
	"motivo_inativacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_imagem_identificador" UNIQUE("tenant_id","identificador")
);
--> statement-breakpoint
CREATE TABLE "imagem_anotacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"imagem_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"geometria" jsonb NOT NULL,
	"texto" text,
	"escala_calibrada" boolean DEFAULT false NOT NULL,
	"autor_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imagem_versao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"imagem_id" uuid NOT NULL,
	"nivel" "nivel_imagem" NOT NULL,
	"chave_storage" text NOT NULL,
	"hash" text,
	"mime_type" text NOT NULL,
	"tamanho_bytes" integer,
	"largura" integer,
	"altura" integer,
	"transformacoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criada_por_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_imagem_versao_nivel" UNIQUE("imagem_id","nivel")
);
--> statement-breakpoint
CREATE TABLE "politica_ia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"perfil_atuacao" text DEFAULT 'conservador' NOT NULL,
	"modulos_habilitados" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"funcoes_exigem_confirmacao" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"funcoes_proibidas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permite_treinamento" text DEFAULT 'nao' NOT NULL,
	"retencao_sugestoes_dias" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sugestao_ia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caso_id" uuid,
	"usuario_id" uuid,
	"componente" text NOT NULL,
	"modulo_contexto" text NOT NULL,
	"etapa" text,
	"nivel" "nivel_ia" NOT NULL,
	"codigo" text,
	"titulo" text NOT NULL,
	"corpo" text NOT NULL,
	"fontes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inferencia" text,
	"evidencias" jsonb,
	"modelo" text,
	"modelo_versao" text,
	"acao_usuario" text,
	"acao_usuario_em" timestamp with time zone,
	"comentario_usuario" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "local_fisico" ADD CONSTRAINT "local_fisico_unidade_id_unidade_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_fisico" ADD CONSTRAINT "local_fisico_setor_id_setor_id_fk" FOREIGN KEY ("setor_id") REFERENCES "public"."setor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setor" ADD CONSTRAINT "setor_unidade_id_unidade_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assinatura_profissional" ADD CONSTRAINT "assinatura_profissional_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfil_permissao" ADD CONSTRAINT "perfil_permissao_perfil_id_perfil_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfil"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissao_individual" ADD CONSTRAINT "permissao_individual_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissao_individual" ADD CONSTRAINT "permissao_individual_concedido_por_usuario_id_fk" FOREIGN KEY ("concedido_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_unidade_ativa_id_unidade_id_fk" FOREIGN KEY ("unidade_ativa_id") REFERENCES "public"."unidade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_unidade_principal_id_unidade_id_fk" FOREIGN KEY ("unidade_principal_id") REFERENCES "public"."unidade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_setor_principal_id_setor_id_fk" FOREIGN KEY ("setor_principal_id") REFERENCES "public"."setor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_perfil" ADD CONSTRAINT "usuario_perfil_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_perfil" ADD CONSTRAINT "usuario_perfil_perfil_id_perfil_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfil"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_unidade" ADD CONSTRAINT "usuario_unidade_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_unidade" ADD CONSTRAINT "usuario_unidade_unidade_id_unidade_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dia_nao_util" ADD CONSTRAINT "dia_nao_util_unidade_id_unidade_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termo" ADD CONSTRAINT "termo_tabela_id_tabela_mestre_id_fk" FOREIGN KEY ("tabela_id") REFERENCES "public"."tabela_mestre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cliente_contato" ADD CONSTRAINT "cliente_contato_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cliente_endereco" ADD CONSTRAINT "cliente_endereco_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paciente" ADD CONSTRAINT "paciente_tutor_id_tutor_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculo_veterinario_cliente" ADD CONSTRAINT "vinculo_veterinario_cliente_veterinario_id_veterinario_id_fk" FOREIGN KEY ("veterinario_id") REFERENCES "public"."veterinario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculo_veterinario_cliente" ADD CONSTRAINT "vinculo_veterinario_cliente_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amostra" ADD CONSTRAINT "amostra_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amostra" ADD CONSTRAINT "amostra_recipiente_id_recipiente_id_fk" FOREIGN KEY ("recipiente_id") REFERENCES "public"."recipiente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caso" ADD CONSTRAINT "caso_unidade_id_unidade_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caso" ADD CONSTRAINT "caso_servico_id_servico_id_fk" FOREIGN KEY ("servico_id") REFERENCES "public"."servico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caso" ADD CONSTRAINT "caso_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caso" ADD CONSTRAINT "caso_veterinario_id_veterinario_id_fk" FOREIGN KEY ("veterinario_id") REFERENCES "public"."veterinario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caso" ADD CONSTRAINT "caso_paciente_id_paciente_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."paciente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caso" ADD CONSTRAINT "caso_remessa_id_remessa_id_fk" FOREIGN KEY ("remessa_id") REFERENCES "public"."remessa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caso" ADD CONSTRAINT "caso_cadastrado_por_id_usuario_id_fk" FOREIGN KEY ("cadastrado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caso" ADD CONSTRAINT "caso_recebido_por_id_usuario_id_fk" FOREIGN KEY ("recebido_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caso" ADD CONSTRAINT "caso_triado_por_id_usuario_id_fk" FOREIGN KEY ("triado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caso" ADD CONSTRAINT "caso_patologista_responsavel_id_usuario_id_fk" FOREIGN KEY ("patologista_responsavel_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_clinico" ADD CONSTRAINT "historico_clinico_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_clinico" ADD CONSTRAINT "historico_clinico_registrado_por_id_usuario_id_fk" FOREIGN KEY ("registrado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nao_conformidade_pre_analitica" ADD CONSTRAINT "nao_conformidade_pre_analitica_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nao_conformidade_pre_analitica" ADD CONSTRAINT "nao_conformidade_pre_analitica_amostra_id_amostra_id_fk" FOREIGN KEY ("amostra_id") REFERENCES "public"."amostra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nao_conformidade_pre_analitica" ADD CONSTRAINT "nao_conformidade_pre_analitica_recipiente_id_recipiente_id_fk" FOREIGN KEY ("recipiente_id") REFERENCES "public"."recipiente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nao_conformidade_pre_analitica" ADD CONSTRAINT "nao_conformidade_pre_analitica_registrada_por_id_usuario_id_fk" FOREIGN KEY ("registrada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipiente" ADD CONSTRAINT "recipiente_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remessa" ADD CONSTRAINT "remessa_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remessa" ADD CONSTRAINT "remessa_unidade_id_unidade_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remessa" ADD CONSTRAINT "remessa_recebida_por_id_usuario_id_fk" FOREIGN KEY ("recebida_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triagem" ADD CONSTRAINT "triagem_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triagem" ADD CONSTRAINT "triagem_amostra_id_amostra_id_fk" FOREIGN KEY ("amostra_id") REFERENCES "public"."amostra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triagem" ADD CONSTRAINT "triagem_executada_por_id_usuario_id_fk" FOREIGN KEY ("executada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triagem" ADD CONSTRAINT "triagem_setor_id_setor_id_fk" FOREIGN KEY ("setor_id") REFERENCES "public"."setor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloqueio" ADD CONSTRAINT "bloqueio_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloqueio" ADD CONSTRAINT "bloqueio_amostra_id_amostra_id_fk" FOREIGN KEY ("amostra_id") REFERENCES "public"."amostra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloqueio" ADD CONSTRAINT "bloqueio_criado_por_id_usuario_id_fk" FOREIGN KEY ("criado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloqueio" ADD CONSTRAINT "bloqueio_liberado_por_id_usuario_id_fk" FOREIGN KEY ("liberado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definicao_workflow" ADD CONSTRAINT "definicao_workflow_servico_id_servico_id_fk" FOREIGN KEY ("servico_id") REFERENCES "public"."servico"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estado_amostra" ADD CONSTRAINT "estado_amostra_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estado_amostra" ADD CONSTRAINT "estado_amostra_amostra_id_amostra_id_fk" FOREIGN KEY ("amostra_id") REFERENCES "public"."amostra"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estado_caso" ADD CONSTRAINT "estado_caso_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estado_caso" ADD CONSTRAINT "estado_caso_workflow_id_definicao_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."definicao_workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estado_caso" ADD CONSTRAINT "estado_caso_responsavel_id_usuario_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etapa_workflow" ADD CONSTRAINT "etapa_workflow_workflow_id_definicao_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."definicao_workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspensao_prazo" ADD CONSTRAINT "suspensao_prazo_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificacao_pendente" ADD CONSTRAINT "notificacao_pendente_evento_id_evento_dominio_id_fk" FOREIGN KEY ("evento_id") REFERENCES "public"."evento_dominio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_evento" ADD CONSTRAINT "outbox_evento_evento_id_evento_dominio_id_fk" FOREIGN KEY ("evento_id") REFERENCES "public"."evento_dominio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cassete" ADD CONSTRAINT "cassete_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cassete" ADD CONSTRAINT "cassete_amostra_id_amostra_id_fk" FOREIGN KEY ("amostra_id") REFERENCES "public"."amostra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cassete" ADD CONSTRAINT "cassete_macroscopia_id_macroscopia_id_fk" FOREIGN KEY ("macroscopia_id") REFERENCES "public"."macroscopia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cassete" ADD CONSTRAINT "cassete_lesao_id_lesao_macroscopica_id_fk" FOREIGN KEY ("lesao_id") REFERENCES "public"."lesao_macroscopica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cassete" ADD CONSTRAINT "cassete_margem_id_margem_macroscopica_id_fk" FOREIGN KEY ("margem_id") REFERENCES "public"."margem_macroscopica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesao_macroscopica" ADD CONSTRAINT "lesao_macroscopica_macroscopia_id_macroscopia_id_fk" FOREIGN KEY ("macroscopia_id") REFERENCES "public"."macroscopia"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macroscopia" ADD CONSTRAINT "macroscopia_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macroscopia" ADD CONSTRAINT "macroscopia_amostra_id_amostra_id_fk" FOREIGN KEY ("amostra_id") REFERENCES "public"."amostra"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macroscopia" ADD CONSTRAINT "macroscopia_executada_por_id_usuario_id_fk" FOREIGN KEY ("executada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macroscopia" ADD CONSTRAINT "macroscopia_aprovada_por_id_usuario_id_fk" FOREIGN KEY ("aprovada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "margem_macroscopica" ADD CONSTRAINT "margem_macroscopica_macroscopia_id_macroscopia_id_fk" FOREIGN KEY ("macroscopia_id") REFERENCES "public"."macroscopia"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloco" ADD CONSTRAINT "bloco_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloco" ADD CONSTRAINT "bloco_cassete_id_cassete_id_fk" FOREIGN KEY ("cassete_id") REFERENCES "public"."cassete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divergencia_cassete" ADD CONSTRAINT "divergencia_cassete_lote_id_lote_envio_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lote_envio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divergencia_cassete" ADD CONSTRAINT "divergencia_cassete_cassete_id_cassete_id_fk" FOREIGN KEY ("cassete_id") REFERENCES "public"."cassete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divergencia_cassete" ADD CONSTRAINT "divergencia_cassete_apontada_por_id_usuario_id_fk" FOREIGN KEY ("apontada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lamina" ADD CONSTRAINT "lamina_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lamina" ADD CONSTRAINT "lamina_bloco_id_bloco_id_fk" FOREIGN KEY ("bloco_id") REFERENCES "public"."bloco"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lamina" ADD CONSTRAINT "lamina_produzida_por_id_usuario_id_fk" FOREIGN KEY ("produzida_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_cassete" ADD CONSTRAINT "lote_cassete_lote_id_lote_envio_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lote_envio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_cassete" ADD CONSTRAINT "lote_cassete_cassete_id_cassete_id_fk" FOREIGN KEY ("cassete_id") REFERENCES "public"."cassete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_envio" ADD CONSTRAINT "lote_envio_laboratorio_apoio_id_unidade_id_fk" FOREIGN KEY ("laboratorio_apoio_id") REFERENCES "public"."unidade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_envio" ADD CONSTRAINT "lote_envio_enviado_por_id_usuario_id_fk" FOREIGN KEY ("enviado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_envio" ADD CONSTRAINT "lote_envio_recebido_parceiro_por_id_usuario_id_fk" FOREIGN KEY ("recebido_parceiro_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem_solicitacao" ADD CONSTRAINT "mensagem_solicitacao_solicitacao_id_solicitacao_id_fk" FOREIGN KEY ("solicitacao_id") REFERENCES "public"."solicitacao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem_solicitacao" ADD CONSTRAINT "mensagem_solicitacao_pendencia_id_pendencia_id_fk" FOREIGN KEY ("pendencia_id") REFERENCES "public"."pendencia"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem_solicitacao" ADD CONSTRAINT "mensagem_solicitacao_autor_id_usuario_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_solicitacao_id_solicitacao_id_fk" FOREIGN KEY ("solicitacao_id") REFERENCES "public"."solicitacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_responsavel_id_usuario_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_criada_por_id_usuario_id_fk" FOREIGN KEY ("criada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_resolvida_por_id_usuario_id_fk" FOREIGN KEY ("resolvida_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao" ADD CONSTRAINT "solicitacao_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao" ADD CONSTRAINT "solicitacao_solicitante_por_id_usuario_id_fk" FOREIGN KEY ("solicitante_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao" ADD CONSTRAINT "solicitacao_responsavel_id_usuario_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao" ADD CONSTRAINT "solicitacao_aprovada_por_id_usuario_id_fk" FOREIGN KEY ("aprovada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacao" ADD CONSTRAINT "solicitacao_concluida_por_id_usuario_id_fk" FOREIGN KEY ("concluida_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contagem_mitotica" ADD CONSTRAINT "contagem_mitotica_laudo_versao_id_laudo_versao_id_fk" FOREIGN KEY ("laudo_versao_id") REFERENCES "public"."laudo_versao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contagem_mitotica" ADD CONSTRAINT "contagem_mitotica_lamina_id_lamina_id_fk" FOREIGN KEY ("lamina_id") REFERENCES "public"."lamina"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostico" ADD CONSTRAINT "diagnostico_laudo_versao_id_laudo_versao_id_fk" FOREIGN KEY ("laudo_versao_id") REFERENCES "public"."laudo_versao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostico" ADD CONSTRAINT "diagnostico_amostra_id_amostra_id_fk" FOREIGN KEY ("amostra_id") REFERENCES "public"."amostra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laudo" ADD CONSTRAINT "laudo_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laudo" ADD CONSTRAINT "laudo_patologista_id_usuario_id_fk" FOREIGN KEY ("patologista_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laudo" ADD CONSTRAINT "laudo_revisor_id_usuario_id_fk" FOREIGN KEY ("revisor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laudo_versao" ADD CONSTRAINT "laudo_versao_laudo_id_laudo_id_fk" FOREIGN KEY ("laudo_id") REFERENCES "public"."laudo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laudo_versao" ADD CONSTRAINT "laudo_versao_criada_por_id_usuario_id_fk" FOREIGN KEY ("criada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laudo_versao" ADD CONSTRAINT "laudo_versao_assinada_por_id_usuario_id_fk" FOREIGN KEY ("assinada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "margem_microscopica" ADD CONSTRAINT "margem_microscopica_laudo_versao_id_laudo_versao_id_fk" FOREIGN KEY ("laudo_versao_id") REFERENCES "public"."laudo_versao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisao_laudo" ADD CONSTRAINT "revisao_laudo_laudo_versao_id_laudo_versao_id_fk" FOREIGN KEY ("laudo_versao_id") REFERENCES "public"."laudo_versao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisao_laudo" ADD CONSTRAINT "revisao_laudo_revisor_id_usuario_id_fk" FOREIGN KEY ("revisor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imagem" ADD CONSTRAINT "imagem_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imagem" ADD CONSTRAINT "imagem_autor_id_usuario_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imagem_anotacao" ADD CONSTRAINT "imagem_anotacao_imagem_id_imagem_id_fk" FOREIGN KEY ("imagem_id") REFERENCES "public"."imagem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imagem_anotacao" ADD CONSTRAINT "imagem_anotacao_autor_id_usuario_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imagem_versao" ADD CONSTRAINT "imagem_versao_imagem_id_imagem_id_fk" FOREIGN KEY ("imagem_id") REFERENCES "public"."imagem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imagem_versao" ADD CONSTRAINT "imagem_versao_criada_por_id_usuario_id_fk" FOREIGN KEY ("criada_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sugestao_ia" ADD CONSTRAINT "sugestao_ia_caso_id_caso_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."caso"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sugestao_ia" ADD CONSTRAINT "sugestao_ia_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_local_unidade" ON "local_fisico" USING btree ("tenant_id","unidade_id");--> statement-breakpoint
CREATE INDEX "idx_local_pai" ON "local_fisico" USING btree ("pai_id");--> statement-breakpoint
CREATE INDEX "idx_setor_unidade" ON "setor" USING btree ("tenant_id","unidade_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_slug" ON "tenant" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_unidade_tenant" ON "unidade" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_assinatura_usuario" ON "assinatura_profissional" USING btree ("tenant_id","usuario_id");--> statement-breakpoint
CREATE INDEX "idx_perfil_tenant" ON "perfil" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_perfil_permissao_perfil" ON "perfil_permissao" USING btree ("tenant_id","perfil_id");--> statement-breakpoint
CREATE INDEX "idx_permissao_individual_usuario" ON "permissao_individual" USING btree ("tenant_id","usuario_id");--> statement-breakpoint
CREATE INDEX "idx_sessao_usuario" ON "sessao" USING btree ("tenant_id","usuario_id");--> statement-breakpoint
CREATE INDEX "idx_sessao_token" ON "sessao" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_usuario_tenant" ON "usuario" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_usuario_status" ON "usuario" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_usuario_cliente" ON "usuario" USING btree ("tenant_id","cliente_id");--> statement-breakpoint
CREATE INDEX "idx_usuario_perfil_usuario" ON "usuario_perfil" USING btree ("tenant_id","usuario_id");--> statement-breakpoint
CREATE INDEX "idx_usuario_unidade_usuario" ON "usuario_unidade" USING btree ("tenant_id","usuario_id");--> statement-breakpoint
CREATE INDEX "idx_dia_nao_util_data" ON "dia_nao_util" USING btree ("tenant_id","data");--> statement-breakpoint
CREATE INDEX "idx_servico_tenant" ON "servico" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_servico_modalidade" ON "servico" USING btree ("tenant_id","modalidade");--> statement-breakpoint
CREATE INDEX "idx_termo_tabela" ON "termo" USING btree ("tenant_id","tabela_id");--> statement-breakpoint
CREATE INDEX "idx_termo_pai" ON "termo" USING btree ("pai_id");--> statement-breakpoint
CREATE INDEX "idx_versao_config_entidade" ON "versao_configuracao" USING btree ("tenant_id","entidade","entidade_id");--> statement-breakpoint
CREATE INDEX "idx_cliente_tenant" ON "cliente" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_cliente_documento" ON "cliente" USING btree ("tenant_id","documento");--> statement-breakpoint
CREATE INDEX "idx_cliente_nome" ON "cliente" USING btree ("tenant_id","nome_fantasia");--> statement-breakpoint
CREATE INDEX "idx_cliente_contato" ON "cliente_contato" USING btree ("tenant_id","cliente_id");--> statement-breakpoint
CREATE INDEX "idx_cliente_endereco" ON "cliente_endereco" USING btree ("tenant_id","cliente_id");--> statement-breakpoint
CREATE INDEX "idx_paciente_tenant" ON "paciente" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_paciente_microchip" ON "paciente" USING btree ("tenant_id","microchip");--> statement-breakpoint
CREATE INDEX "idx_paciente_tutor" ON "paciente" USING btree ("tenant_id","tutor_id");--> statement-breakpoint
CREATE INDEX "idx_paciente_nome" ON "paciente" USING btree ("tenant_id","nome");--> statement-breakpoint
CREATE INDEX "idx_tutor_tenant" ON "tutor" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tutor_nome" ON "tutor" USING btree ("tenant_id","nome");--> statement-breakpoint
CREATE INDEX "idx_veterinario_tenant" ON "veterinario" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_veterinario_nome" ON "veterinario" USING btree ("tenant_id","nome");--> statement-breakpoint
CREATE INDEX "idx_vinculo_cliente" ON "vinculo_veterinario_cliente" USING btree ("tenant_id","cliente_id");--> statement-breakpoint
CREATE INDEX "idx_vinculo_veterinario" ON "vinculo_veterinario_cliente" USING btree ("tenant_id","veterinario_id");--> statement-breakpoint
CREATE INDEX "idx_amostra_caso" ON "amostra" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_caso_tenant" ON "caso" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_caso_cliente" ON "caso" USING btree ("tenant_id","cliente_id");--> statement-breakpoint
CREATE INDEX "idx_caso_paciente" ON "caso" USING btree ("tenant_id","paciente_id");--> statement-breakpoint
CREATE INDEX "idx_caso_unidade" ON "caso" USING btree ("tenant_id","unidade_id");--> statement-breakpoint
CREATE INDEX "idx_caso_patologista" ON "caso" USING btree ("tenant_id","patologista_responsavel_id");--> statement-breakpoint
CREATE INDEX "idx_caso_cadastrado_em" ON "caso" USING btree ("tenant_id","cadastrado_em");--> statement-breakpoint
CREATE INDEX "idx_historico_caso" ON "historico_clinico" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_nc_caso" ON "nao_conformidade_pre_analitica" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_nc_gravidade" ON "nao_conformidade_pre_analitica" USING btree ("tenant_id","gravidade");--> statement-breakpoint
CREATE INDEX "idx_recipiente_caso" ON "recipiente" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_remessa_tenant" ON "remessa" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_triagem_caso" ON "triagem" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_triagem_amostra" ON "triagem" USING btree ("tenant_id","amostra_id");--> statement-breakpoint
CREATE INDEX "idx_bloqueio_caso" ON "bloqueio" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_bloqueio_ativo" ON "bloqueio" USING btree ("tenant_id","caso_id","liberado_em");--> statement-breakpoint
CREATE INDEX "idx_workflow_servico" ON "definicao_workflow" USING btree ("tenant_id","servico_id");--> statement-breakpoint
CREATE INDEX "idx_estado_amostra_caso" ON "estado_amostra" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_estado_caso_etapa" ON "estado_caso" USING btree ("tenant_id","etapa");--> statement-breakpoint
CREATE INDEX "idx_estado_caso_responsavel" ON "estado_caso" USING btree ("tenant_id","responsavel_id");--> statement-breakpoint
CREATE INDEX "idx_estado_caso_alerta" ON "estado_caso" USING btree ("tenant_id","alerta_prazo");--> statement-breakpoint
CREATE INDEX "idx_etapa_workflow" ON "etapa_workflow" USING btree ("tenant_id","workflow_id","ordem");--> statement-breakpoint
CREATE INDEX "idx_suspensao_caso" ON "suspensao_prazo" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_evento_caso" ON "evento_dominio" USING btree ("tenant_id","caso_id","ocorrido_em");--> statement-breakpoint
CREATE INDEX "idx_evento_tipo" ON "evento_dominio" USING btree ("tenant_id","tipo");--> statement-breakpoint
CREATE INDEX "idx_evento_ocorrido" ON "evento_dominio" USING btree ("tenant_id","ocorrido_em");--> statement-breakpoint
CREATE INDEX "idx_evento_objeto" ON "evento_dominio" USING btree ("tenant_id","objeto_tipo","objeto_id");--> statement-breakpoint
CREATE INDEX "idx_notificacao_status" ON "notificacao_pendente" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_notificacao_caso" ON "notificacao_pendente" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_outbox_pendente" ON "outbox_evento" USING btree ("status","proxima_tentativa_em");--> statement-breakpoint
CREATE INDEX "idx_outbox_evento" ON "outbox_evento" USING btree ("evento_id");--> statement-breakpoint
CREATE INDEX "idx_audit_entidade" ON "audit_log" USING btree ("tenant_id","entidade","entidade_id");--> statement-breakpoint
CREATE INDEX "idx_audit_usuario" ON "audit_log" USING btree ("tenant_id","usuario_id");--> statement-breakpoint
CREATE INDEX "idx_audit_caso" ON "audit_log" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_audit_criado" ON "audit_log" USING btree ("tenant_id","criado_em");--> statement-breakpoint
CREATE INDEX "idx_cassete_caso" ON "cassete" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_cassete_amostra" ON "cassete" USING btree ("tenant_id","amostra_id");--> statement-breakpoint
CREATE INDEX "idx_cassete_status" ON "cassete" USING btree ("tenant_id","status_tecnico");--> statement-breakpoint
CREATE INDEX "idx_lesao_macroscopia" ON "lesao_macroscopica" USING btree ("tenant_id","macroscopia_id");--> statement-breakpoint
CREATE INDEX "idx_macroscopia_caso" ON "macroscopia" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_macroscopia_executor" ON "macroscopia" USING btree ("tenant_id","executada_por_id");--> statement-breakpoint
CREATE INDEX "idx_margem_macroscopia" ON "margem_macroscopica" USING btree ("tenant_id","macroscopia_id");--> statement-breakpoint
CREATE INDEX "idx_bloco_caso" ON "bloco" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_bloco_cassete" ON "bloco" USING btree ("tenant_id","cassete_id");--> statement-breakpoint
CREATE INDEX "idx_divergencia_lote" ON "divergencia_cassete" USING btree ("tenant_id","lote_id");--> statement-breakpoint
CREATE INDEX "idx_lamina_caso" ON "lamina" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_lamina_bloco" ON "lamina" USING btree ("tenant_id","bloco_id");--> statement-breakpoint
CREATE INDEX "idx_lote_cassete_lote" ON "lote_cassete" USING btree ("tenant_id","lote_id");--> statement-breakpoint
CREATE INDEX "idx_lote_data" ON "lote_envio" USING btree ("tenant_id","data_envio");--> statement-breakpoint
CREATE INDEX "idx_lote_status" ON "lote_envio" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_mensagem_solicitacao" ON "mensagem_solicitacao" USING btree ("tenant_id","solicitacao_id");--> statement-breakpoint
CREATE INDEX "idx_mensagem_pendencia" ON "mensagem_solicitacao" USING btree ("tenant_id","pendencia_id");--> statement-breakpoint
CREATE INDEX "idx_pendencia_caso" ON "pendencia" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_pendencia_status" ON "pendencia" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_pendencia_responsavel" ON "pendencia" USING btree ("tenant_id","responsavel_id");--> statement-breakpoint
CREATE INDEX "idx_solicitacao_caso" ON "solicitacao" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_solicitacao_status" ON "solicitacao" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_solicitacao_responsavel" ON "solicitacao" USING btree ("tenant_id","responsavel_id");--> statement-breakpoint
CREATE INDEX "idx_contagem_versao" ON "contagem_mitotica" USING btree ("tenant_id","laudo_versao_id");--> statement-breakpoint
CREATE INDEX "idx_diagnostico_versao" ON "diagnostico" USING btree ("tenant_id","laudo_versao_id");--> statement-breakpoint
CREATE INDEX "idx_diagnostico_entidade" ON "diagnostico" USING btree ("tenant_id","entidade");--> statement-breakpoint
CREATE INDEX "idx_laudo_caso" ON "laudo" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_laudo_status" ON "laudo" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_laudo_patologista" ON "laudo" USING btree ("tenant_id","patologista_id");--> statement-breakpoint
CREATE INDEX "idx_laudo_versao_laudo" ON "laudo_versao" USING btree ("tenant_id","laudo_id");--> statement-breakpoint
CREATE INDEX "idx_laudo_versao_codigo" ON "laudo_versao" USING btree ("codigo_validacao");--> statement-breakpoint
CREATE INDEX "idx_margem_micro_versao" ON "margem_microscopica" USING btree ("tenant_id","laudo_versao_id");--> statement-breakpoint
CREATE INDEX "idx_revisao_versao" ON "revisao_laudo" USING btree ("tenant_id","laudo_versao_id");--> statement-breakpoint
CREATE INDEX "idx_imagem_caso" ON "imagem" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_imagem_objeto" ON "imagem" USING btree ("tenant_id","objeto_tipo","objeto_id");--> statement-breakpoint
CREATE INDEX "idx_imagem_tipo" ON "imagem" USING btree ("tenant_id","tipo");--> statement-breakpoint
CREATE INDEX "idx_anotacao_imagem" ON "imagem_anotacao" USING btree ("tenant_id","imagem_id");--> statement-breakpoint
CREATE INDEX "idx_imagem_versao" ON "imagem_versao" USING btree ("tenant_id","imagem_id");--> statement-breakpoint
CREATE INDEX "idx_politica_ia_tenant" ON "politica_ia" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sugestao_caso" ON "sugestao_ia" USING btree ("tenant_id","caso_id");--> statement-breakpoint
CREATE INDEX "idx_sugestao_componente" ON "sugestao_ia" USING btree ("tenant_id","componente");--> statement-breakpoint
CREATE INDEX "idx_sugestao_nivel" ON "sugestao_ia" USING btree ("tenant_id","nivel");--> statement-breakpoint
CREATE INDEX "idx_sugestao_codigo" ON "sugestao_ia" USING btree ("tenant_id","codigo");