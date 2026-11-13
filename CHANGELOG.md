# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.10.0] - 2026-11-13

### Adicionado
- Sugestões na barra de endereço, como no Opera: ao digitar, aparecem as pesquisas sugeridas pelo Google e, separados, o que casa no histórico, nos favoritos e nas abas abertas do workspace (sem acento, palavras em qualquer ordem). Setas escolhem, Enter ou clique abrem, Esc fecha. O site que começa com o digitado completa o domínio na própria barra ("you" → youtube.com). Para as pesquisas sugeridas, vai ao Google só o texto digitado (sem cookies nem login); dá para desligar em Configurações → Histórico, e nos workspaces temporários nunca é usado.

### Corrigido
- KDE: depois de uma atualização do AppImage, o navegador padrão (links de outros apps) continuava chamando o arquivo antigo, que não existe mais. A entrada do Apollo no menu era corrigida, mas o KDE não percebia; agora ele refaz o cache de aplicativos na hora.

## [0.9.2] - 2026-11-12

Mesmo conteúdo da 0.9.1, que não chegou a ser publicada (o release falhou no CI).

### Corrigido
- Atualização do AppImage ("Instalar e reiniciar"): o Apollo não abria de novo, e o arquivo mudava de nome a cada versão (Apollo-0.8.0.AppImage → Apollo-0.9.0.AppImage), quebrando o atalho do menu e o navegador padrão. Agora o AppImage se chama sempre `Apollo.AppImage` (a atualização grava por cima do mesmo arquivo), a versão nova abre sozinha depois que a antiga fecha, e a entrada do Apollo no menu acompanha o arquivo (e se conserta ao abrir, se apontar para um AppImage que não existe mais). Na primeira atualização com essa correção o arquivo passa a se chamar `Apollo.AppImage`.

## [0.9.1] - 2026-11-11

Não publicada: os testes do release falharam por um erro do espelho de pacotes do Ubuntu. O conteúdo saiu na 0.9.2.

## [0.9.0] - 2026-11-11

### Adicionado
- Câmera e microfone nos painéis laterais (chamadas no WhatsApp/Teams do painel): o pedido aparece na barra de permissão, marcado "(painel)"; o menu do painel ganhou Permissões (câmera, microfone, notificações: permitir, bloquear ou perguntar).
- Importar favoritos do Opera, Chrome, Edge, Brave, Chromium e Firefox instalados no computador (Configurações → Favoritos → Importar de outro navegador): cada perfil aparece com a quantidade; os favoritos entram numa pasta nova da barra do workspace escolhido, com as pastas de lá (inclusive a Discagem rápida do Opera).
- Modelos de issue (bug, sugestão) e de PR; relato privado de falhas de segurança.
- Pacote no AUR (`apollo-browser-bin`), atualizado automaticamente a cada versão; instalado assim, o aviso de versão nova manda atualizar pelo gerenciador de pacotes.
- Todo PR para `dev` ou `main` precisa da aprovação do mantenedor (CODEOWNERS + regra do repositório).
- Ícone do Apollo: um sol de raios ondulados (instaladores, AppImage, janela e menu de aplicativos). Gerado por `scripts/make-icon.mjs`.
- Ícones nos workspaces: escolha um emoji (grade de sugestões ou cole qualquer um) para aparecer na barra lateral no lugar da primeira letra. Sincroniza entre computadores.

### Corrigido
- Clicar numa notificação criada pelo service worker do site (WhatsApp, Teams e outros usam esse tipo) não levava a lugar nenhum. Agora leva à aba do site (a mais recente, mesmo em outro workspace), ou ao painel dele, ou abre o site numa aba.
- Monitor de memória mostrava quase o dobro do real (ex.: 5,5 GB com o sistema marcando 2,8 GB): somava a memória residente de cada processo, contando várias vezes o que os processos do Chromium compartilham. Agora usa o PSS no Linux e a memória privada no Windows — o total bate com o gerenciador de tarefas.

### Removido
- Cópia das versões para o repositório antigo `apollo-releases` (descontinuado): as versões ficam só em davidosanjoss/apollo.

## [0.8.0] - 2026-11-10

### Corrigido
- Ctrl+R num terminal web (busca no histórico de comandos) recarregava a página. Como no Chrome, atalhos que não são do navegador (recarregar, buscar, imprimir, zoom, Ctrl+K…) vão primeiro para a página; se ela não usar, o Apollo age.
- Login do Google recusado ("This browser or app may not be secure"): ao tirar o "Electron" do user agent, as client hints (navigator.userAgentData e os cabeçalhos sec-ch-ua) sumiam; agora o Apollo se apresenta como um Chromium comum, com marca e versão (sem fingir ser o Google Chrome). Painéis "versão para celular" se apresentam como celular.

### Adicionado
- Código aberto sob a GPL-3.0-or-later, com guia de contribuição (CONTRIBUTING.md). As versões agora são publicadas no próprio repositório (davidosanjoss/apollo); o atualizador e o aviso de versão olham para lá (as instalações antigas continuam recebendo pelo apollo-releases durante a transição).
- Navegador padrão: Configurações → Sobre → "Tornar o Apollo o navegador padrão" (Linux: entrada no menu de aplicativos com ícone e registro pelo xdg-settings, vale para KDE/GNOME; Windows: abre a escolha de aplicativos padrão). Links de outros programas abrem numa aba (na vazia, se houver), com o Apollo aberto ou não.
- Login do Google: nas páginas de login (accounts.google.com, accounts.youtube.com) o Apollo usa a identificação original do Electron, que o Google aceita — "igual ao Chrome" ou "como Firefox" ele recusa. Nos outros sites continua a identificação limpa. Opção em Configurações → Privacidade (ligada).
- Senhas por subdomínio: por padrão, cada senha só é oferecida no subdomínio onde foi salva (ex.: moodle.ufmg.br, não sistemas.ufmg.br). Configurações → Bitwarden: voltar ao domínio inteiro. A regra de cada login no Bitwarden tem prioridade; logins novos salvos pelo Apollo já levam a regra.
- Vídeo flutuante sempre por cima das outras janelas (Configurações → Vídeo, ligado por padrão). No KDE Plasma (Wayland) o Apollo pede isso ao KWin com um script temporário que só mexe nas janelas de vídeo flutuante do próprio Apollo, descarregado ao fechar.
- Sincronização entre computadores pelo Google Drive ou OneDrive (Configurações → Sincronização): workspaces, favoritos com pastas, painéis, personalizações e preferências. Tudo é cifrado no computador com uma senha de sincronização sua antes de ir para a nuvem, numa pasta do aplicativo (o Apollo não vê seus arquivos). Abas, histórico, cookies, logins e senhas não sincronizam. Precisa de um ID de aplicativo do Google/Microsoft: passo a passo em docs/SYNC.md.
- Tela dividida: duas abas lado a lado (botão direito na aba → "Dividir a tela com a aba atual", ou Ctrl+K). Clique numa metade para ela virar a ativa (faixa colorida no topo; barra de endereço, Ctrl+F e zoom seguem a ativa); arraste a divisória para ajustar (duplo clique: meio a meio); trocar os lados ou sair pelo mesmo menu. Lembrada por workspace, inclusive depois de reiniciar; fechar uma das abas desfaz.
- Modo leitura (F9, botão na barra de endereço quando a página parece um artigo, ou Ctrl+K): só o texto e as imagens do artigo, sem menus, anúncios nem scripts da página; tamanho do texto, fonte (com/sem serifa) e tema (claro, sépia, escuro) salvos. Sair recarrega a página original.
- Vídeo flutuante (picture-in-picture): botão na barra de endereço quando a página tem vídeo, "Vídeo flutuante" no botão direito do vídeo (inclusive YouTube/streaming) e no Ctrl+K. Configurações → Vídeo: flutuar automaticamente ao trocar de aba. A aba com vídeo flutuando não hiberna.
- Lista de downloads guardada por 7 dias (Configurações → Downloads: só enquanto o Apollo está aberto, 1, 7, 30 ou 90 dias). Downloads interrompidos ao fechar aparecem como "falhou"; os arquivos nunca são apagados.

## [0.7.0] - 2026-11-10

### Adicionado
- Hibernação "Ao sair da aba": a aba libera a memória assim que você troca de aba (exceções continuam: áudio, formulário não enviado, sempre ativa).
- Workspace fora da tela: as abas de um workspace em que você não está hibernam após 10 min (ajustável: ao sair do workspace, 5–60 min ou a mesma regra).
- Aviso de versão nova em qualquer instalação (inclusive tar.gz e pacotes): uma janela mostra as novidades da versão, com "Baixar e instalar" (AppImage/Windows) ou "Abrir a página de download", "Depois" e "Pular esta versão". Depois de atualizar, as novidades da versão aparecem uma vez. A consulta vai só à página pública de versões, sem nenhum dado seu.
- Configurações viraram uma página, com navegação lateral: Privacidade, DNS seguro, Histórico, Downloads, Favoritos, Idiomas, Bitwarden, Módulos e personalizações (antes um diálogo à parte) e Sobre o Apollo (versão e "Verificar atualizações"). Fecha no ✕, com Esc ou ao trocar de aba; volta na última seção aberta.
- Barra de favoritos por workspace (Ctrl+Shift+B mostra/esconde), com pastas e subpastas: pastas abrem como menu (subpastas em submenus, "Abrir todos em abas"), o que não cabe vai para o "»", arrastar reordena ou põe dentro de uma pasta, botão direito para editar, renomear, nova pasta/subpasta, excluir. "Gerenciar favoritos" mostra a árvore inteira (arrastar, renomear, excluir). O diálogo do favorito ganhou a escolha da pasta.
- Busca, histórico, downloads e monitor de memória agora ficam no rodapé da barra lateral direita. Novo: janela de histórico (Ctrl+H), por dia, com busca, apagar um item ou tudo.
- Novo ícone para as permissões do site (controles deslizantes, sem confundir com as Configurações).
- Notificações: sem decisão, o site agora vê "perguntar" (antes via "negado" e WhatsApp/Gmail nem pediam) e o pedido aparece na barra do Apollo. "Permitir" sem "Lembrar" vale até fechar o Apollo (antes a notificação falhava logo depois de permitir). Clicar numa notificação leva à aba (mesmo em outro workspace) ou abre o painel. Menu do painel → Notificações: permitir, bloquear ou perguntar.
- Imprimir (Ctrl+P, também no botão direito), tela cheia (F11: só a página, sem abas/barras; aviso de como sair) e ferramentas do desenvolvedor (F12 ou Ctrl+Shift+I, em janela própria). Também no Ctrl+K.
- Vídeo em tela cheia (YouTube etc.) agora cobre a janela inteira — antes ficava preso no espaço da aba, com a interface visível.
- Histórico pesquisável no Ctrl+K: páginas visitadas do workspace, sem acento e com as palavras em qualquer ordem, mais visitadas e recentes primeiro (sem repetir abas abertas e favoritos). Nunca nos workspaces temporários; últimos 90 dias. Configurações → Histórico: desligar ou apagar tudo.
- Zoom por site: Ctrl+= / Ctrl+- / Ctrl+0 e Ctrl+roda do mouse, em degraus como no Chrome; guardado por site em cada workspace (vale para todas as abas do site e sobrevive ao reinício). Indicador "125%" na barra (clique volta a 100%) e ações no Ctrl+K.
- Downloads: vão direto para a pasta Downloads, sem sobrescrever ("nota (1).pdf"); botão ↓ na barra com anel de progresso e lista (pausar, retomar, cancelar, abrir, mostrar na pasta, limpar). Configurações → Downloads: perguntar onde salvar cada arquivo. "Salvar como…" no botão direito sempre pergunta.
- Localizar na página (Ctrl+F): barra com contagem ("2 de 5"), Enter/F3/Ctrl+G para o próximo e Shift para o anterior, Esc fecha; fecha sozinha ao trocar de aba.
- Menu de contexto nas páginas e painéis (botão direito): link (abrir em nova aba ou em segundo plano, copiar endereço/texto, salvar), imagem (abrir, copiar, copiar endereço, salvar), vídeo/áudio, texto selecionado (copiar, pesquisar no Google), campos (desfazer, recortar, colar, colar sem formatação, sugestões do corretor e "adicionar ao dicionário", Bitwarden), página (voltar, avançar, recarregar, ver código-fonte) e Inspecionar.
- Aba de código-fonte guarda o "view-source:" (antes reabria a página normal ao restaurar).
- Favoritos por workspace: estrela na barra de endereço ou Ctrl+D (abre um diálogo para editar nome e endereço, ou remover); aparecem como blocos na página inicial (clique abre na mesma aba, Ctrl/botão do meio em nova aba, botão direito edita, arrastar reordena) e no Ctrl+K.
- Compartilhar a tela (Teams, Meet…): seletor do Apollo com miniaturas — uma aba do Apollo (com o áudio dela, se quiser), ou tela/janela (no Linux/Wayland pelo seletor do próprio sistema; no Windows com miniaturas e som do computador opcional). Cancelar recusa o pedido. A aba compartilhada continua sendo transmitida mesmo quando você troca de aba, e não hiberna enquanto isso.
- Nova aba sem processo: a página inicial é desenhada pela própria interface; o processo do site só nasce quando você abre um endereço (Ctrl+T instantâneo e menos memória com abas vazias). "Voltar" continua levando à página inicial.
- Corretor ortográfico em português (Brasil) e inglês por padrão (antes baixava só inglês); Configurações → Corretor ortográfico: só português ou desligado (desligado não baixa nenhum dicionário).
- Painéis laterais: "Hibernar agora" e "Hibernar quando fechado" (nunca — padrão, para mensageiros —, ao fechar, ou após 30 min/2 h/8 h). Painel tocando áudio nunca hiberna; hibernado aparece esmaecido no trilho.

### Corrigido
- Mudar a largura de um painel desligava a "versão para celular" dele.
- Um erro inesperado no processo principal podia travar o navegador inteiro (agora é só registrado no log).

## [0.6.0] - 2026-11-10

### Adicionado
- Painéis laterais (como os mensageiros do Opera): sites fixos numa coluna à direita (WhatsApp, Telegram, Teams, agendas, Spotify…), cada um com os logins de um workspace escolhido. Abrem ao lado da página (que encolhe), continuam vivos quando fechados e só carregam quando abertos pela primeira vez. Largura ajustada arrastando a borda esquerda do painel e salva para cada painel (duplo clique na borda volta ao padrão). Opções no botão direito: recarregar, versão para celular, largura padrão, remover. Links abertos no painel viram abas do workspace dele.
- Módulos (Configurações → Módulos e personalizações, ou pela paleta): ligar/desligar GPC, filtros cosméticos e scriptlets, oferecer salvar senhas, hibernação automática e personalizações.
- Personalizações por site: seu CSS e JavaScript nos sites escolhidos (ex.: esconder comentários do YouTube, acelerar vídeos do Moodle). O JavaScript roda num mundo isolado: mexe na página, mas não enxerga as variáveis dela nem o Apollo. Valem a partir do próximo carregamento da página.
- Paleta de comandos (Ctrl+K ou a lupa na barra): busca abas de todos os workspaces, troca de workspace, ações (nova aba, reabrir, fixar, duplicar, agrupar, hibernar, monitor de memória, pausar proteção, Bitwarden, gerar senha, configurações) e abre endereços ou pesquisas. Busca tolerante, sem se importar com acentos.

### Corrigido
- Linux/Wayland: o log não se enche mais de "Unable to set image transfer function" (gerenciamento de cor do Wayland desligado; sem efeito em imagem SDR).
- `npm run diagnose` não mostra mais como erro o cookie de sessão (o Apollo o restaura por conta própria).
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
