#!/bin/bash
# =============================================================================
# Cria o usuario da APLICACAO, separado do dono do schema.
#
# Regra do Engineering Blueprint secao 7: o usuario de banco da aplicacao NAO
# pode ter BYPASSRLS. Se tivesse, as policies de Row-Level Security nao valeriam
# nada e um filtro esquecido em qualquer modulo vazaria dados entre instituicoes.
#
# - lapato_owner : dono do schema, roda migrations (usuario do container)
# - lapato_app   : usado pela API e pelo worker, sujeito a RLS
# =============================================================================
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	DO \$\$
	BEGIN
		IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_DB_USER}') THEN
			CREATE ROLE ${APP_DB_USER} LOGIN PASSWORD '${APP_DB_PASSWORD}'
				NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
		END IF;
	END
	\$\$;

	-- Sem permissao de criar objetos: schema e das migrations.
	GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${APP_DB_USER};
	GRANT USAGE ON SCHEMA public TO ${APP_DB_USER};

	-- Vale para as tabelas que as migrations criarem depois.
	ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
		GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_DB_USER};
	ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
		GRANT USAGE, SELECT ON SEQUENCES TO ${APP_DB_USER};

	CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EOSQL

echo "usuario de aplicacao ${APP_DB_USER} criado (NOBYPASSRLS)"
