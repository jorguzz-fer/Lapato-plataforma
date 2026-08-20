#!/usr/bin/env bash
#
# Backup do banco do LAPATO (Engineering Blueprint seção 5).
#
# Gera dump comprimido, cifra com GPG e descarta cópias locais antigas.
#
# IMPORTANTE: copiar o resultado para FORA da VPS é passo obrigatório e NÃO está
# aqui — depende do destino escolhido (S3, rsync, Backblaze). Backup no mesmo
# disco do banco não protege contra perda do servidor.
#
# Uso:
#   BACKUP_GPG_RECIPIENT=<key-id> ./infra/backup.sh
#
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker compose -f ${RAIZ}/infra/docker-compose.yml"

DESTINO="${BACKUP_DIR:-/var/backups/lapato}"
RETENCAO_DIAS="${BACKUP_RETENTION_DAYS:-7}"
DATA="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ARQUIVO="${DESTINO}/lapato-${DATA}.sql.gz"

if [[ -z "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  echo "ERRO: BACKUP_GPG_RECIPIENT não definido." >&2
  echo "O backup contém dados clínicos e pessoais; cifrar não é opcional." >&2
  exit 1
fi

mkdir -p "${DESTINO}"

echo "[$(date -u +%FT%TZ)] iniciando dump..."

# `--clean --if-exists` deixa o dump restaurável sobre um banco já existente.
# `-Fp` (texto) porque o volume ainda é pequeno e texto é mais fácil de
# inspecionar; migrar para `-Fc` quando o dump passar de alguns GB.
$COMPOSE exec -T postgres pg_dump \
  -U "${POSTGRES_MIGRATOR_USER:-lapato_owner}" \
  -d "${POSTGRES_DB:-lapato}" \
  --clean --if-exists -Fp \
  | gzip -9 > "${ARQUIVO}"

TAMANHO="$(du -h "${ARQUIVO}" | cut -f1)"
echo "[$(date -u +%FT%TZ)] dump gerado: ${ARQUIVO} (${TAMANHO})"

echo "[$(date -u +%FT%TZ)] cifrando..."
gpg --batch --yes --trust-model always \
  --recipient "${BACKUP_GPG_RECIPIENT}" \
  --output "${ARQUIVO}.gpg" \
  --encrypt "${ARQUIVO}"

# O dump em claro sai do disco assim que a versão cifrada existe.
rm -f "${ARQUIVO}"

echo "[$(date -u +%FT%TZ)] cifrado: ${ARQUIVO}.gpg"

# Retenção local. A cópia off-site tem política própria.
find "${DESTINO}" -name 'lapato-*.sql.gz.gpg' -mtime "+${RETENCAO_DIAS}" -delete
echo "[$(date -u +%FT%TZ)] concluído. Retenção local: ${RETENCAO_DIAS} dias."

echo
echo "PENDENTE: enviar ${ARQUIVO}.gpg para fora da VPS."
echo "Enquanto isso não estiver automatizado, o backup não protege contra perda do servidor."
