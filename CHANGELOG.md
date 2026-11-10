# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- Painéis laterais (como os mensageiros do Opera): sites fixos numa coluna à direita (WhatsApp, Telegram, Teams, agendas, Spotify…), cada um com os logins de um workspace escolhido. Abrem ao lado da página (que encolhe), continuam vivos quando fechados e só carregam quando abertos pela primeira vez. Opções no botão direito: recarregar, versão para celular, largura, remover. Links abertos no painel viram abas do workspace dele.
- Módulos (Configurações → Módulos e personalizações, ou pela paleta): ligar/desligar GPC, filtros cosméticos e scriptlets, oferecer salvar senhas, hibernação automática e personalizações.
- Personalizações por site: seu CSS e JavaScript nos sites escolhidos (ex.: esconder comentários do YouTube, acelerar vídeos do Moodle). O JavaScript roda num mundo isolado: mexe na página, mas não enxerga as variáveis dela nem o Apollo. Valem a partir do próximo carregamento da página.
- Paleta de comandos (Ctrl+K ou a lupa na barra): busca abas de todos os workspaces, troca de workspace, ações (nova aba, reabrir, fixar, duplicar, agrupar, hibernar, monitor de memória, pausar proteção, Bitwarden, gerar senha, configurações) e abre endereços ou pesquisas. Busca tolerante, sem se importar com acentos.

### Corrigido
- ⚙ → "Módulos e personalizações…" deixava a tela escura sem mostrar o diálogo (a página voltava por cima ao trocar de um diálogo para outro).

## [0.5.0] - 2026-11-10

### Adicionado
- Bitwarden nativo (sem extensão): conectar com a chave de API pessoal + senha mestra (bitwarden.com, bitwarden.eu ou servidor próprio/Vaultwarden). A senha mestra nunca sai do computador; o cofre fica cifrado na memória e senhas só são decifradas na hora do uso.
- Chave do Bitwarden na barra de endereço: mostra quantos logins servem para o site (regras de correspondência do Bitwarden) e abre um menu para preencher, copiar usuário/senha ou o código de verificação (TOTP). Ctrl+Shift+L preenche o primeiro login. Senha copiada é apagada da área de transferência em 30 s.
- Preenchimento seguro: só no frame principal, conferindo na hora que a página ainda é do site do login; login https nunca é oferecido em página http; campos escondidos (armadilhas) são ignorados. Funciona em logins de duas etapas (e-mail primeiro, senha depois).
- Salvar senhas no Bitwarden: ao fazer login num site, uma barra oferece salvar (ou atualizar, se a senha mudou), "Agora não" ou "Nunca neste site". Funciona com logins em duas etapas. Com o cofre bloqueado, a barra pede para desbloquear e depois salva. Atualizar troca só a senha: notas, campos, TOTP e passkeys ficam intactos, e a senha antiga vai para o histórico.
- Gerador de senhas no menu da chave: "Gerar senha e preencher" (preenche senha e confirmação de cadastros) e "Gerar senha e copiar"; tamanho e símbolos configuráveis no diálogo do cofre.
- Bloqueio automático do cofre: após um tempo sem usar o computador (padrão 15 min), ao bloquear a tela, ao suspender e ao fechar o Apollo. Desbloqueio funciona sem internet (cópia local cifrada com o chaveiro do sistema).
- Compatibilidade testada contra servidor real (Vaultwarden) e o CLI oficial do Bitwarden, inclusive contas Argon2id e itens de organização.

### Corrigido
- O contador de bloqueios do escudo podia mostrar menos itens que o real (zerava tarde demais em máquinas lentas).
- Conectar ao bitwarden.com falhava com "HTTP 400: No client version header found": o servidor oficial exige a versão do cliente em toda requisição (o Vaultwarden não exige).
- Avisos de API descontinuada do Electron (chaveiro do sistema): cookies de sessão e segredos do Bitwarden passam a usar a API assíncrona; o segredo do Bitwarden é regravado com a chave atual do chaveiro a cada sincronização.
- Elementos que deveriam estar escondidos em diálogos apareciam (ex.: "Temporário" ao editar um workspace).

## [0.4.0] - 2026-11-09

### Adicionado
- Bloqueador de anúncios e rastreadores (motor do Ghostery; listas EasyList, EasyPrivacy e uBlock), com interruptores separados.
- Regras em camadas: padrão global → workspace → site (dentro do workspace) → aba. Ex.: liberar rastreadores do Outlook só no workspace do Trabalho. Ajuste no escudo da barra de endereço e no diálogo do workspace; "Pausar proteção nesta aba" vale até a aba fechar.
- Filtros cosméticos (escondem os espaços de anúncio, inclusive os que aparecem depois) e scriptlets do uBlock (ex.: anúncios do YouTube), seguindo o mesmo interruptor "anúncios".
- Escudo na barra de endereço: mostra a proteção do domínio (verde = anúncios e rastreadores bloqueados, amarelo = parcial, tracejado = liberado) e quantos itens foram bloqueados; o clique abre um menu para bloquear/liberar anúncios e rastreadores naquele domínio (sobrescrevendo o padrão; cookies de terceiros e limpeza de links em "Mais proteções"), voltar ao padrão ou pausar só na aba.
- A engrenagem ao lado do endereço agora mostra só as permissões do site, num menu como o do escudo (destacada quando o site tem alguma permissão definida). A barra que abria embaixo foi removida.
- Cookies de terceiros bloqueados (não são enviados nem gravados), tratando como uma parte só os sites da mesma empresa que dependem uns dos outros para login (Microsoft: Outlook/Office/Teams/login; Google: contas/Gmail/YouTube). Liberável por site no escudo (Mais proteções).
- Limpeza de links: parâmetros de rastreamento (`utm_*`, `fbclid`, `gclid`, `msclkid`…) são removidos ao abrir uma página.
- Configurações (⚙ na barra lateral): DNS — modo e endereço DoH (ex.: Cloudflare Zero Trust Gateway), aplicado na hora, com botão "Testar" — e padrões globais de privacidade.
- Workspace temporário: logins e dados só na memória, nada gravado no disco; apagado ao fechar o Apollo.
- Listas embutidas no app e atualizadas semanalmente em segundo plano (thread separada), direto das listas públicas — sem conta e sem telemetria.

## [0.3.0] - 2026-11-09

### Adicionado
- Logins que dependem de cookies de sessão (Microsoft/Outlook, SSO de empresa e faculdade) continuam ativos depois de fechar e abrir o Apollo. Os cookies ficam cifrados com o chaveiro do sistema; sem chaveiro, não são salvos.
- Voltar/avançar e a posição de rolagem de cada aba são restaurados ao reabrir.
- Ctrl+Shift+T reabre a última aba fechada, no mesmo lugar e com o histórico.
- Tamanho, posição e estado maximizado da janela são lembrados (se o monitor sumiu, a janela abre centralizada).
- Arrastar abas para reordenar.
- Abas fixadas: ficam no começo, compactas (só o ícone).
- Grupos de abas com nome e cor: recolher/expandir clicando no chip (recolhido mostra a quantidade, ex.: "Faculdade (3)"), arrastar abas para dentro/fora, desagrupar, fechar grupo. Abas abertas a partir de uma aba do grupo entram no grupo.
- Hibernação: abas paradas além do tempo do workspace (padrão 30 min; ajustável ou "Nunca" no diálogo do workspace) liberam a memória e recarregam ao clicar, com histórico e rolagem. Nunca hibernam: a aba na tela, as marcadas como "sempre ativa", as tocando áudio/vídeo e as com formulário não enviado. Fixadas hibernam normalmente.
- "Hibernar agora" e "Hibernar outras abas" no menu da aba.
- Monitor de memória (Shift+Esc ou ▤ na barra): total, navegador/GPU e cada aba de todos os workspaces, com botão para hibernar e clique para ir até a aba. Limite de memória opcional: acima dele, as abas menos usadas hibernam. Só mede enquanto aberto.
- Menu do botão direito na aba: nova aba à direita, recarregar, duplicar (com histórico), fixar, manter sempre ativa, grupos, fechar outras / à direita, reabrir aba fechada.

### Corrigido
- Escolher DNS "Desligado" com o Apollo aberto não desfazia o DNS sobre HTTPS até reiniciar.
- Com um grupo recolhido, a aba nova (inclusive a criada ao recolher o grupo quando não havia outras abas) nascia dentro do grupo. Agora nasce fora, depois dele; "Nova aba no grupo" expande o grupo e cria dentro.
- Ao ir para uma aba vazia, a barra de endereço continuava mostrando a URL da aba anterior.
- Navegar logo ao abrir o Apollo, antes de a sessão terminar de ser restaurada, era desfeito (a aba voltava para a página anterior).

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
