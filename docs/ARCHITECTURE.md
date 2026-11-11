# Arquitetura do Apollo

## Requisitos

| Requisito | Implicação |
|---|---|
| Google e Microsoft funcionando 100% | Motor Chromium, o que descarta Tauri/WebKitGTK |
| Leve: não carregar tudo, nada inútil em segundo plano | Restauração preguiçosa, hibernação de abas, módulos nativos em vez de extensões |
| Vídeo e aba ativa sem limitação | Decodificação por hardware, aba tocando mídia nunca hiberna |
| Workspaces com logins isolados | Uma partição de sessão (`persist:ws-<id>`) por workspace |
| Streaming com DRM | castLabs ECS (Electron com Widevine) |
| Bitwarden | Cliente nativo do protocolo Bitwarden (não a extensão) |
| Bloqueadores desativáveis por aba/site/workspace | Pipeline de rede central com regras em camadas |
| Grupos de abas e sessão restaurada | SQLite com salvamento contínuo |
| Privacidade | Zero telemetria, nenhum dado sai sem motivo |
| Linux e Windows | Electron multiplataforma, builds pelo CI |

## Decisões

### D1: Electron (castLabs ECS) como base
Alternativas avaliadas:
- **Tauri:** WebKitGTK quebra apps Google/Microsoft.
- **Qt WebEngine:** Chromium atrasado e ecossistema menor.
- **Fork de Chromium/Firefox:** manutenção inviável para uma pessoa.

O ECS é o Electron oficial com Widevine. Custo: atualizar no ritmo do Electron (no mínimo mensalmente) por segurança.

### D2: Processo principal é dono das páginas
Implementado na fase 1 com `WebContentsView` (antes: `<webview>`).

- A UI (sidebar, abas, barra) é uma camada sem privilégios.
- Páginas rodam em sandbox, sem Node e sem preload.
- Nenhum site tem caminho até o código que controla o navegador.

```
Processo principal (confiável)                       src/main/
 ├─ Browser            workspaces, abas (WebContentsView), layout, atalhos   browser.ts
 ├─ PermissionManager  negado por padrão, decisão por workspace + origem      permissions.ts
 ├─ NetworkPipeline    um único interceptador por sessão; módulos se plugam  network.ts
 ├─ Store              SQLite (node:sqlite), migrações versionadas           store.ts, db.ts
 ├─ protocolo apollo:// páginas internas (ui, home, error)                   protocol.ts
 ├─ IPC                remetente e formato validados                          ipc.ts
 └─ Vault              cliente Bitwarden (fase 4)
UI (sandbox, apollo://ui) ◄── comandos tipados / estado ──►  src/renderer/, src/preload/
Páginas (sandbox) ── sem IPC, sem Node, sem acesso à UI
```

A UI não guarda estado: recebe snapshots (`UiState`) e envia comandos (`UiCommand`), definidos em `src/shared/types.ts`.
A página nativa da aba ativa é desenhada por cima da área `#views` da UI; diálogos da UI escondem a página enquanto estão abertos.

### D3: Pipeline de rede central
O Electron aceita **um** listener por evento `webRequest` por sessão. Bloqueador, cookies de terceiros, limpeza de URL e GPC são etapas de um único pipeline.

Regras resolvidas em camadas, da menos para a mais específica:

```
global → workspace → site no workspace → aba (temporária)
```

Interruptores independentes: anúncios, rastreadores, cookies de terceiros, limpeza de URL. Requisições de service workers (sem aba) usam a regra de site/workspace.

- "Site" = domínio registrável (eTLD+1, via `tldts`): `outlook.office.com` → `office.com`.
- Motores do Ghostery (`@ghostery/adblocker`), um para anúncios e outro para rastreadores, montados no build a partir das listas públicas (`scripts/build-filters.mjs`) e embutidos em `build/filters/`. Atualização semanal num `worker_thread` (`filters-worker`), gravada em `<userData>/filters`; usa-se o mais novo entre embutido e baixado.
- Cosméticos e scriptlets: preload próprio das abas (`src/preload/tab.ts`, sem nada exposto à página). O pedido inicial é síncrono (`sendSync`) para os scriptlets rodarem antes dos scripts da página; todos vão num único script (como o uBlock), senão scriptlets que interceptam a mesma função (ex.: dois `json-prune`) se encadeiam e quebram a página. O motor inclui os recursos do uBlock (`resources.json`), sem os quais não há scriptlets.
- Cookies de terceiros: na rede (remove `Cookie`/`Set-Cookie` de requisições a outro site), com grupos de sites da mesma empresa tratados como uma parte só (`third-party.ts`). Limitação: `document.cookie` dentro de iframes de terceiros não é bloqueado.
- Limpeza de URL: só navegação principal GET, regra do site de destino (`url-cleaning.ts`).
- Regras salvas em `privacy_rules` (global/workspace/site); a camada da aba fica só em memória. Cache em memória por workspace|site, invalidado a cada mudança (a verificação roda a cada requisição).

### D4: Hibernação de abas
- Aba hibernada = WebContents destruído. Ficam url, título, favicon, histórico de navegação (`navigationHistory.restore`) e posição de rolagem.
- **Nunca hiberna:** fixadas, tocando mídia, em chamada, marcadas "sempre ativo", com `beforeunload`.
- Gatilhos: tempo por workspace e teto de memória (hiberna as usadas há mais tempo primeiro).

### D5: Sessão e grupos em SQLite
```
Workspace ─ abas fixadas, grupos (nome, cor, recolhido) ─ abas
```
- Salvo a cada mudança, então sobrevive a travamento.
- Na abertura, restaura tudo, mas só carrega a aba ativa.
- **Cookies de sessão não sobrevivem a reinício no Electron** (fase 0). O Apollo deve persisti-los por conta própria para a restauração manter logins.

### D6: Bitwarden nativo
- Implementa o protocolo do Bitwarden: login, derivação de chave local, `/sync` e decifra em memória.
- **Não** usa `bw serve`, que expõe uma API local sem autenticação.
- Preenchimento só no domínio exato e nunca em iframe de outra origem.
- Bloqueio automático. Compatível com bitwarden.com e Vaultwarden.
- Conexão pela **chave de API pessoal** (client_credentials, como `bw login --apikey`) + senha mestra só local. E-mail/senha também é suportado (servidores próprios), mas o bitwarden.com pode exigir captcha/verificação de dispositivo novo para clientes que não conhece.
- Cofre em memória continua **cifrado**: só nome, usuário e URLs são decifrados; senha/TOTP na hora do uso. Chaves em `Buffer` zeradas ao bloquear.
- KDF: PBKDF2 (Node) e Argon2id (`hash-wasm`: o Electron, com BoringSSL, não implementa Argon2). Parâmetros mínimos recusam KDF fraco vindo do servidor.
- Compatibilidade provada contra Vaultwarden + CLI oficial (`tests/interop`).
- Preenchimento: o main confere `mainFrame.url` contra as URIs do login no momento do pedido e envia só para o frame principal (`mainFrame.send`); o preload da aba preenche (`src/preload/fill.ts`). Regras de correspondência do Bitwarden (`vault/match.ts`), mais: login https nunca em página http.
- TOTP (RFC 6238) gerado localmente; área de transferência limpa em 30 s.
- Salvar senhas: o preload percebe o envio do login (submit, clique em botão, Enter) e manda usuário+senha ao main, que usa a URL do frame (nunca a da página) e guarda a senha só em memória por 5 min; a UI recebe só site e usuário. Itens novos com chave própria, `encryptedFor` e `uriChecksum` (exigidos pelos clientes/servidores atuais). Atualização copia o item cifrado como veio e troca só a senha (`vault.ts: passwordUpdateRequest`).

### D7: DNS via Cloudflare Zero Trust Gateway
- DoH em modo `secure`. O endereço do Gateway fica em `settings.json` local, nunca no repositório.
- Limitação: o DNS é global do app, não por workspace.
- Configurável pela tela de configurações; gravado em `settings.json` local com permissão 0600.

### D8: Privacidade
- **Padrões:** sem telemetria, permissões negadas por padrão, cookies de terceiros bloqueados (com exceções de SSO Microsoft/Google), EasyPrivacy, GPC, limpeza de URL, workspace temporário opcional.
- **Fora do alcance:** dados coletados pelos próprios serviços onde você está logado, fingerprinting completo, Safe Browsing (troca consciente).

### D9: Segurança do binário
- Fuses (aplicados em `scripts/after-pack.cjs`): `RunAsNode`, `NODE_OPTIONS` e `--inspect` desligados; `EnableCookieEncryption` e `OnlyLoadAppFromAsar` ligados; `file://` sem privilégios extras (a UI é servida por `apollo://`).
- Cookies já existentes (não cifrados) continuam válidos após ligar a criptografia (testado).
- Pendente: validação de integridade do ASAR no Windows (exige suporte do electron-builder; não testável sem Windows).
- Windows: assinatura VMP do castLabs para DRM, aplicada depois dos fuses.

### D10: Permissões
- Liberadas: tela cheia, escrita na área de transferência, DRM, pointer/keyboard lock.
- Perguntam (barra na UI, decisão salva por workspace + origem): câmera, microfone, localização, leitura da área de transferência, MIDI, abrir apps externos, acesso a cookies entre sites.
- Notificações: bloqueadas até o usuário liberar no painel do site (⚙). O Electron não tem o estado "perguntar" para verificações síncronas, e um site que vê "permitido" mostraria notificações sem pedir.
- Negadas: compartilhamento de tela (até existir um seletor de telas), detecção de ociosidade, gerenciamento de janelas, sistema de arquivos e o resto.

### D11: Perfis
- App instalado: `~/.config/apollo` (Windows: `%APPDATA%\apollo`).
- Desenvolvimento (`npm start`): `~/.config/apollo-dev`, para nunca mexer nos dados reais.
- Uma instância por perfil (a segunda só foca a primeira).

### D12: Módulos e personalizações
- Módulos internos com interruptor (`modules.ts`): GPC, cosméticos/scriptlets, oferecer salvar senhas, hibernação automática, personalizações. Privacidade de rede (anúncios, rastreadores, cookies, limpeza de links) fica nas camadas de privacidade (D3).
- Personalizações do usuário: CSS inserido como estilo de usuário; JS executado num mundo isolado próprio (`executeJavaScriptInIsolatedWorld`, id 1001) no `dom-ready` — acesso ao DOM, sem acesso às variáveis da página, ao preload do Apollo ou ao Node. Não há extensões de terceiros nem código carregado no processo principal.

### D13: Mundos isolados nas páginas
Código do Apollo que roda nas páginas usa mundos isolados próprios (a página não enxerga nem altera): 1001 personalizações, 1002 vídeo flutuante, 1003 modo leitura (`build/reader.js`, Readability). O modo leitura troca o documento dentro da própria página (com CSP sem scripts) — o conteúdo do site nunca passa pela interface privilegiada.

### D14: Sincronização
Google Drive (pasta do app) ou OneDrive (pasta do app), com OAuth + PKCE e retorno em 127.0.0.1. Um arquivo só, cifrado com a senha do usuário (scrypt + AES-256-GCM) antes de sair do computador; mesclagem em três vias contra a última versão sincronizada (`src/main/sync/`). Detalhes e como criar o ID do aplicativo: [SYNC.md](SYNC.md).

## Roadmap

0. ✅ Validação técnica ([phase-0.md](phase-0.md))
1. ✅ Base: TypeScript, WebContentsView, SQLite, pipeline de rede, permissões, fuses
2. ✅ Sessão e abas: restauração, grupos, hibernação, monitor de memória
3. ✅ Privacidade: bloqueador em camadas, cookies de terceiros, DoH, limpeza de URL, workspace temporário
4. ✅ Bitwarden nativo
5. ✅ Módulos, painéis laterais, paleta de comandos
6. ✅ Navegador completo: favoritos com pastas, histórico, downloads, localizar, zoom por site, menu de contexto, imprimir, tela cheia, compartilhar tela, tela dividida, modo leitura, vídeo flutuante, notificações, navegador padrão, aviso de versão nova
7. ✅ Código aberto (GPL-3.0), releases no próprio repositório, proteções e revisão de PRs

### Próximos

- Importar do Opera/Chrome: favoritos (com pastas) e histórico.
- Painéis com câmera e microfone (barra de permissão também nos painéis).
- Notificações enviadas pelo *service worker* do site (WhatsApp, Teams): clicar levar à aba.
- Para contribuições: modelos de issue/PR, Dependabot, CodeQL; interface também em inglês.
- Windows: testes de integração no CI, instalador assinado (custo: ~US$ 10/mês), DRM (VMP do castLabs, conta gratuita).

### Backlog (com data)

- **AUR** (`apollo-browser-bin`): pacote pronto em `packaging/aur/` e job de publicação no workflow `Release`. Falta a configuração da conta e do secret `AUR_SSH_PRIVATE_KEY` (ver [RELEASING.md](RELEASING.md)) — o cadastro no AUR estava temporariamente fechado em novembro de 2026; retomar quando reabrir.
- **Sincronização com ID de aplicativo oficial** (janeiro de 2027): registrar um domínio, publicar a política de privacidade, cadastrar o app no Google (escopo `drive.appdata`, não sensível: sem auditoria paga) e na Microsoft (verificação de publicador, gratuita), e embutir os IDs para ninguém precisar criar o próprio. Junto: envio condicional (evitar perda quando dois computadores enviam ao mesmo tempo).
