#!/usr/bin/env bash
# Publica a versão no AUR: packaging/aur/publish.sh <versão> <clone do repositório do AUR>
# (rodado pelo workflow Release como usuário comum, com a chave SSH do AUR configurada).
set -euo pipefail
version="${1:?versão}"
aur="${2:?pasta do clone do AUR}"
here="$(cd "$(dirname "$0")" && pwd)"
cp "$here/PKGBUILD" "$here/apollo-browser.desktop" "$here/apollo-browser.svg" "$aur/"
cd "$aur"
sed -i "s/^pkgver=.*/pkgver=$version/; s/^pkgrel=.*/pkgrel=1/" PKGBUILD
updpkgsums
makepkg --printsrcinfo > .SRCINFO
git add PKGBUILD .SRCINFO apollo-browser.desktop apollo-browser.svg
if git diff --cached --quiet; then echo "AUR já está em $version"; exit 0; fi
git -c user.name='davidosanjoss' -c user.email='davidosanjoss@users.noreply.github.com' commit -q -m "Atualiza para $version"
git push origin HEAD:master
echo "AUR atualizado para $version"
