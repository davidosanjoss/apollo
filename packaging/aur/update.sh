#!/usr/bin/env bash
# Atualiza o PKGBUILD para uma versão: packaging/aur/update.sh 0.9.0
# Baixa o tar.gz da release, calcula os sha256 e gera o .SRCINFO (precisa de makepkg).
set -euo pipefail
cd "$(dirname "$0")"
version="${1:?uso: update.sh <versão>}"
sed -i "s/^pkgver=.*/pkgver=$version/; s/^pkgrel=.*/pkgrel=1/" PKGBUILD
updpkgsums
makepkg --printsrcinfo > .SRCINFO
echo "PKGBUILD e .SRCINFO em $version"
