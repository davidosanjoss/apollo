# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.2.0] - 2026-11-09

### Adicionado
- Página inicial própria (`apollo://home`): relógio, data e pesquisa, sem carregar nada externo.
- Permissões negadas por padrão: câmera, microfone, localização etc. pedem autorização numa barra, e a decisão é lembrada por site e por workspace.
- Painel de permissões do site (⚙ ao lado da barra de endereço), incluindo liberar notificações.
- Página de erro quando um site não carrega (antes a aba ficava em branco).
- Cabeçalho Global Privacy Control (`Sec-GPC: 1`) em todas as requisições.
- Proteções do binário (fuses): cookies cifrados no disco, sem execução como Node, sem injeção via `NODE_OPTIONS`/`--inspect`.

### Alterado
- Primeira execução começa com um único workspace ("Principal") na página inicial, em vez de três workspaces abrindo o Outlook. Workspaces existentes são mantidos.
- Desenvolvimento (`npm start`) usa um perfil separado (`apollo-dev`), sem tocar nos logins do app instalado.
- Nova base em TypeScript: o processo principal controla as abas (`WebContentsView`); a interface não tem mais nenhum privilégio.
- Workspaces, abas e permissões agora ficam num banco SQLite. O `state.json` da v0.1.0 é migrado automaticamente na primeira abertura, mantendo workspaces e logins (backup em `state.json.migrated`).
- Abas só carregam ao serem abertas: iniciar o navegador carrega apenas a aba ativa.
- Apenas uma janela do Apollo por perfil; abrir de novo foca a existente.

### Corrigido
- Fechar aba ou trocar de workspace exigia dois cliques quando a barra de endereço estava focada (ex.: em uma aba nova).
- Barra de endereço: `localhost:3000` e `dominio.com:8443` não abriam; endereços IP (ex.: `192.168.0.1`) iam para a pesquisa; textos como `c++: dúvida` não pesquisavam.
- Um `state.json` corrompido impedia o Apollo de abrir.
- Ao recusar um banco de uma versão mais nova, o arquivo ficava aberto (no Windows, travado).
- A validação de comandos da interface aceitava tipos de permissão inválidos (ex.: `toString`).

### Interno
- Testes unitários (Vitest) e de integração com o app real, rodando no CI e obrigatórios no release.

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
