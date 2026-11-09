# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- Página inicial própria (`apollo://home`): relógio, data e pesquisa, sem carregar nada externo.

### Alterado
- Primeira execução começa com um único workspace ("Principal") na página inicial, em vez de três workspaces abrindo o Outlook. Workspaces existentes são mantidos.
- Desenvolvimento (`npm start`) usa um perfil separado (`apollo-dev`), sem tocar nos logins do app instalado.

## [0.1.0] - 2026-11-09

Primeira versão: protótipo para validar a base. Ainda não recomendado para uso diário.

### Adicionado
- Workspaces com sessão isolada (cookies, storage e logins próprios por workspace).
- Abas por workspace, barra de endereço e atalhos (Ctrl+T/W/L/R, Ctrl+Tab, Ctrl+1–9).
- Popups de login (SSO/OAuth) abrem na sessão do workspace de origem.
- Widevine (DRM) via castLabs ECS.
- Decodificação de vídeo por hardware no Linux (VA-API).
- DNS sobre HTTPS (Cloudflare Zero Trust Gateway configurável em `settings.json`).
- `npm run diagnose`: validação técnica da máquina.
- Atualização automática com confirmação do usuário (AppImage e instalador do Windows).
- Builds para Linux (AppImage, tar.gz) e Windows (NSIS, zip), com CI e release automáticos.
