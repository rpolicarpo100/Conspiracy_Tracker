#!/usr/bin/env bash
# =====================================================================
# Servidor LOCAL de desenvolvimento e testes de interface.
#
# Diferenças em relação a produção, e só estas:
#   · REGISTER_OPEN=true       — as suites precisam de criar contas descartáveis;
#   · DATA_DIR próprio         — .data-dev, nunca o diretório de produção;
#   · APP_SECRET de teste      — gerado por sessão, sem valor fixo no repositório.
#
# Nunca usar este script em produção: o registo público aberto é exactamente
# aquilo que a fase 8 fechou.
# =====================================================================
set -eu
cd "$(dirname "$0")/.."
export APP_SECRET="${APP_SECRET:-$(head -c 24 /dev/urandom | base64 | tr -d '\n/' | head -c 32)}"
export DATA_DIR="${DATA_DIR:-$PWD/.data-dev}"
export REGISTER_OPEN=true
export REGISTER_MAX="${REGISTER_MAX:-500}"
export LOGIN_MAX_ATTEMPTS="${LOGIN_MAX_ATTEMPTS:-100}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@meridiano.test}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-SenhaForteAdmin123}" 
export PORT="${PORT:-8080}"
echo "[dev] registo aberto (só local) · dados em $DATA_DIR · porta $PORT"
exec node tools/serve.mjs
