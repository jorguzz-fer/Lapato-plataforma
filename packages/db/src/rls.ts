import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/**
 * Row-Level Security (ADR 0002, Blueprint secao 7).
 *
 * Em vez de listar tabela por tabela - lista que envelhece mal e deixa buracos
 * quando alguem esquece de atualizar - a policy e aplicada por descoberta:
 * **toda tabela com coluna `tenant_id` recebe RLS**. Criar tabela de dominio sem
 * policy passa a ser impossivel por construcao, nao por disciplina.
 *
 * O teste `rls.test.ts` confere o inverso: nenhuma tabela com `tenant_id` ficou
 * de fora, e o tenant A realmente nao enxerga o tenant B.
 */

/**
 * Tabelas que NAO entram na RLS por tenant, com a razao de cada uma.
 *
 * Qualquer nome adicionado aqui precisa de justificativa - e uma excecao a
 * defesa em profundidade.
 */
export const TABELAS_SEM_RLS = [
  // Ela e o proprio tenant; nao tem `tenant_id`. Consultada apenas pelo slug no
  // login, antes de existir sessao.
  'tenant',
  // Infraestrutura do outbox: guarda FK e estado de retry, sem conteudo de
  // dominio. O worker precisa varrer a fila de todos os tenants; ao processar
  // cada item, abre `comTenant` antes de tocar em dado real.
  'outbox_evento',
  // Sessao: e consultada pelo token ANTES de existir tenant no contexto - e
  // justamente ela que revela a qual instituicao o request pertence. Sob RLS,
  // nenhuma sessao seria encontrada e ninguem conseguiria autenticar.
  // Nao guarda dado clinico: apenas hash do token, usuario, tenant, IP e
  // user-agent. O isolamento aqui vem do proprio token, que e aleatorio de 32
  // bytes e cuja forma em claro nunca e persistida.
  'sessao',
  // Controle de versao de schema do Drizzle.
  '__drizzle_migrations',
] as const;

/**
 * SQL que ativa a RLS e cria a policy de isolamento em todas as tabelas de
 * dominio. Idempotente: pode rodar a cada deploy.
 *
 * A policy usa `NULLIF(current_setting('app.current_tenant', true), '')::uuid`:
 *
 * - o segundo argumento `true` evita erro quando a variavel nunca foi definida;
 * - o `NULLIF` trata o caso em que ela existe mas esta vazia. Isso acontece de
 *   verdade: apos um `set_config(..., is_local => true)`, o fim da transacao
 *   devolve a variavel ao valor anterior, que passa a ser **string vazia** e
 *   nao NULL. Sem o NULLIF, o cast para uuid levantaria
 *   `invalid input syntax for type uuid: ""` em vez de simplesmente nao
 *   retornar linhas.
 *
 * Como `tenant_id = NULL` e sempre falso, **uma consulta sem tenant definido
 * nao retorna nada** - falha fechada, que e o comportamento correto.
 */
export const SQL_APLICAR_RLS = `
DO $$
DECLARE
  r RECORD;
  excecoes TEXT[] := ARRAY['tenant', 'outbox_evento', 'sessao', '__drizzle_migrations'];
BEGIN
  -- Idempotencia nos dois sentidos: se uma tabela passou a ser excecao depois
  -- de ja ter recebido policy, a policy antiga precisa sair. Sem isto, mudar a
  -- lista de excecoes nao teria efeito num banco ja migrado.
  FOR r IN
    SELECT c.relname AS tabela
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = ANY(excecoes)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS isolamento_tenant ON public.%I', r.tabela);
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', r.tabela);
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tabela);
  END LOOP;
  FOR r IN
    SELECT c.relname AS tabela
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'tenant_id'
      AND NOT a.attisdropped
      AND NOT (c.relname = ANY(excecoes))
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tabela);
    -- FORCE faz a policy valer inclusive para o dono da tabela, para que um
    -- descuido rodando como owner nao contorne o isolamento.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.tabela);

    EXECUTE format('DROP POLICY IF EXISTS isolamento_tenant ON public.%I', r.tabela);
    EXECUTE format(
      'CREATE POLICY isolamento_tenant ON public.%I
         USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)',
      r.tabela
    );
  END LOOP;
END
$$;
`;

/**
 * Imutabilidade de `evento_dominio` e `audit_log`.
 *
 * DIRETRIZES secao 13 e M07: "eventos historicos imutaveis: erro gera correcao
 * ou anulacao, nunca exclusao". A Introducao secao 6.6 exige trilha de auditoria
 * que permita reconstruir o que aconteceu.
 *
 * Regra em trigger, e nao apenas na aplicacao, porque uma trilha de auditoria
 * que o proprio sistema pode reescrever nao serve como trilha de auditoria.
 */
export const SQL_IMUTABILIDADE = `
CREATE OR REPLACE FUNCTION public.impedir_alteracao_registro_imutavel()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'A tabela % e append-only: % nao e permitido. Registre um evento de correcao.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_evento_dominio_imutavel ON public.evento_dominio;
CREATE TRIGGER trg_evento_dominio_imutavel
  BEFORE UPDATE OR DELETE ON public.evento_dominio
  FOR EACH ROW EXECUTE FUNCTION public.impedir_alteracao_registro_imutavel();

DROP TRIGGER IF EXISTS trg_audit_log_imutavel ON public.audit_log;
CREATE TRIGGER trg_audit_log_imutavel
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.impedir_alteracao_registro_imutavel();
`;

/**
 * Concede a role da aplicacao acesso as tabelas criadas pelas migrations.
 *
 * O `ALTER DEFAULT PRIVILEGES` do script de init cobre tabelas futuras; este
 * grant cobre as que acabaram de ser criadas na mesma execucao.
 */
export function sqlConcederAcessoApp(usuarioApp: string): string {
  // O nome vem de variavel de ambiente controlada pela infra, nunca de entrada
  // de usuario; ainda assim, restringimos ao formato de identificador valido.
  if (!/^[a-z_][a-z0-9_]*$/i.test(usuarioApp)) {
    throw new Error(`Nome de role invalido: ${usuarioApp}`);
  }
  return `
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${usuarioApp};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${usuarioApp};

    -- Leitura do controle de migrations do Drizzle. E o que permite a API
    -- checar, na subida, se o schema do banco corresponde ao do codigo
    -- (ver \`estadoMigrations\`). Somente SELECT: quem escreve ali e o migrator,
    -- rodando com o dono do schema.
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA drizzle TO ${usuarioApp}';
        EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO ${usuarioApp}';
      END IF;
    END
    $$;
  `;
}

/** Aplica RLS, triggers de imutabilidade e grants. Chamado apos as migrations. */
export async function aplicarPoliticas(db: Database, usuarioApp?: string): Promise<void> {
  await db.execute(sql.raw(SQL_APLICAR_RLS));
  await db.execute(sql.raw(SQL_IMUTABILIDADE));
  if (usuarioApp) {
    await db.execute(sql.raw(sqlConcederAcessoApp(usuarioApp)));
  }
}

/**
 * Lista tabelas de dominio (com `tenant_id`) que estao sem RLS.
 * Usado pelo teste de schema: o resultado precisa ser sempre vazio.
 */
export async function tabelasSemPolitica(db: Database): Promise<string[]> {
  // `sql.join` monta uma lista de placeholders individuais. Passar o array
  // direto faria o driver enviar um unico parametro, e o Postgres recusaria com
  // "op ANY/ALL (array) requires array on right side".
  const excecoes = sql.join(
    TABELAS_SEM_RLS.map((nome) => sql`${nome}`),
    sql`, `,
  );

  const resultado = await db.execute<{ tabela: string }>(sql`
    SELECT c.relname AS tabela
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'tenant_id'
      AND NOT a.attisdropped
      AND c.relname NOT IN (${excecoes})
      AND (
        c.relrowsecurity = false
        OR NOT EXISTS (
          SELECT 1 FROM pg_policy p
          WHERE p.polrelid = c.oid AND p.polname = 'isolamento_tenant'
        )
      )
  `);

  return Array.from(resultado).map((linha) => linha.tabela);
}
