#!/usr/bin/env bash
# Tudo que precisa passar antes de um commit. Falha (código ≠ 0) se qualquer etapa falhar.
set -euo pipefail
npm run -s typecheck
npm test -- --reporter=dot
npm run -s test:e2e -- --reporter=dot
echo "✔ tudo verde"
