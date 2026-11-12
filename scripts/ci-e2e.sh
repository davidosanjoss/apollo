#!/usr/bin/env bash
# Testes de integração no CI (Linux sem tela): tela virtual + chaveiro do sistema.
# Sem chaveiro, o Apollo (corretamente) não salva cookies de sessão — e o teste de
# restauração de login falharia.
set -euo pipefail

# Ubuntu 24.04 bloqueia user namespaces sem privilégio; o sandbox do Chromium precisa deles.
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
# A lista de pacotes da imagem do runner envelhece; sem update, o espelho devolve 404.
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends gnome-keyring >/dev/null

export XDG_CURRENT_DESKTOP=GNOME
xvfb-run -a dbus-run-session -- bash -c '
  echo -n "ci" | gnome-keyring-daemon --unlock --components=secrets >/dev/null
  npm run test:e2e
'
