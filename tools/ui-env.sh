#!/usr/bin/env bash
# Corre testes de interface (Playwright) neste ambiente sem root.
#
#   bash tools/ui-env.sh tests/mfa-ui.mjs
#   bash tools/ui-env.sh node tests/flow.mjs
#
# Porque existe: o Chromium do Playwright precisa de bibliotecas de sistema
# (libnspr4, libnss3, libatk…) que este contentor não tem instaladas. Sem root,
# tools/setup-ui-env.sh extrai os pacotes .deb para ~/.local/lib; este script
# só aponta o LD_LIBRARY_PATH para lá e escolhe o binário do Chromium.
#
# Se as bibliotecas faltarem, o erro do Chromium é explícito
# («error while loading shared libraries: libnspr4.so») — nunca um teste que
# finge passar. Correr primeiro: bash tools/setup-ui-env.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LD_LIBRARY_PATH="${HOME}/.local/lib/usr/lib/x86_64-linux-gnu:${HOME}/.local/lib/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

CHROME="$(ls -d "${HOME}"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | sort | tail -1 || true)"
if [ -n "${CHROME}" ]; then export CHROMIUM_PATH="${CHROME}"; fi

cd "${ROOT}"
if [ "$#" -eq 0 ]; then
  echo "uso: bash tools/ui-env.sh <ficheiro-de-teste.mjs | node ...>" >&2
  exit 64
fi
case "$1" in
  node) shift; exec node "$@" ;;
  npm)  shift; exec npm "$@" ;;
  *)    exec node "$@" ;;
esac
