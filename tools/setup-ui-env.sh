#!/usr/bin/env bash
# =====================================================================
# Ambiente para os testes de INTERFACE (Playwright/Chromium) sem root.
#
# Problema: o Chromium que o Playwright descarrega precisa de bibliotecas
# de sistema (libnspr4, libnss3, libatk, libcups, …). Numa máquina sem root
# não se pode `apt-get install`. Solução: descarregar os pacotes `.deb` e
# extraí-los para ~/.local/lib, apontando LD_LIBRARY_PATH para lá.
#
# Uso:
#   bash tools/setup-ui-env.sh          # prepara (idempotente)
#   source tools/ui-env.sh              # exporta LD_LIBRARY_PATH na sessão
#   node tests/account-ui.mjs           # corre a interface
#
# Nota: ~/.local não entra na cópia de segurança do espaço de trabalho
# (é cache de ambiente). Correr este script de novo recria tudo.
# =====================================================================
set -u
DEST="${HOME}/.local/lib"
mkdir -p "$DEST"
PKGS="libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libxkbcommon0 \
libasound2t64 libxdamage1 libatspi2.0-0t64 libxcomposite1 libxfixes3 libxrandr2 libgbm1 \
libpango-1.0-0 libcairo2 libx11-6 libxcb1 libxext6 libdrm2 libxrender1 libxi6 libxtst6 \
libxshmfence1 libavahi-common3 libavahi-client3 libdbus-1-3 libfontconfig1 libfreetype6 \
libpixman-1-0 libpng16-16 libxcb-render0 libxcb-shm0 libxcb-sync1 libxcb-shape0 \
libxcb-xfixes0 libxcb-randr0 libxcb-glx0 libxcb-dri3-0 libxcb-present0 libxcb-xkb1 \
libxkbcommon-x11-0 libegl1 libglvnd0 libglx0 libwayland-client0 libwayland-server0 \
libwayland-cursor0 libwayland-egl1 libharfbuzz0b libgraphite2-3 libbrotli1 libffi8 \
libselinux1 libpcre2-8-0 libbsd0 liblzma5 libuuid1 libsystemd0 libgcrypt20 libgpg-error0 \
liblz4-1 libcrypt1 libtinfo6 libudev1 libmount1 libblkid1 libacl1 libcap-ng0 libseccomp2 \
libfribidi0 libthai0 libdatrie1"

TMP="$(mktemp -d)"
cd "$TMP" || exit 1
echo "[ui-env] a descarregar bibliotecas (sem root)…"
for p in $PKGS; do apt-get download "$p" >/dev/null 2>&1 || true; done
for f in ./*.deb; do [ -e "$f" ] || continue; dpkg-deb -x "$f" "$DEST" 2>/dev/null || true; done
cd - >/dev/null || exit 1
rm -rf "$TMP"

# Gera um ficheiro PRÓPRIO para o ambiente. Antes escrevia em tools/ui-env.sh e
# destruía o executor dos testes (`bash tools/ui-env.sh npm test`) — o teste
# deixava de correr e o script saía com código 0, o que é pior do que falhar.
cat > tools/ui-env.generated.sh <<'EOF'
# gerado por tools/setup-ui-env.sh — carregar com: source tools/ui-env.generated.sh
export LD_LIBRARY_PATH="$HOME/.local/lib/usr/lib/x86_64-linux-gnu:$HOME/.local/lib/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
EOF
echo "[ui-env] bibliotecas em $DEST"
echo "[ui-env] para esta sessão: source tools/ui-env.generated.sh"

CHROME="$(node -e "try{const {chromium}=require('playwright');console.log(chromium.executablePath())}catch(e){console.log('')}" 2>/dev/null)"
if [ -n "$CHROME" ] && [ -x "$CHROME" ]; then
  if LD_LIBRARY_PATH="$HOME/.local/lib/usr/lib/x86_64-linux-gnu:$HOME/.local/lib/lib/x86_64-linux-gnu" "$CHROME" --version >/dev/null 2>&1; then
    echo "[ui-env] Chromium arranca: $(LD_LIBRARY_PATH="$HOME/.local/lib/usr/lib/x86_64-linux-gnu" "$CHROME" --version)"
  else
    echo "[ui-env] AVISO: o Chromium ainda não arranca — ver 'ldd $CHROME | grep 'not found''"
  fi
else
  echo "[ui-env] Chromium do Playwright ainda não instalado: npx playwright install chromium --no-shell"
fi
