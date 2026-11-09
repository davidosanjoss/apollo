# Testes

| Comando | O que roda | Tempo |
|---|---|---|
| `npm test` | Unitários (`tests/unit`): Node puro, sem abrir o Electron | ~1 s |
| `npm run test:watch` | Unitários em modo observação | — |
| `npm run test:e2e` | Integração (`tests/e2e`): compila e abre o Apollo de verdade | ~5 s |
| `npm run typecheck` | Tipos de `src/` e `tests/` | — |

O CI roda tipos + unitários em todo push na `dev` e em PRs (Linux e Windows), e os de integração no Linux com tela virtual e chaveiro do sistema (`scripts/ci-e2e.sh`: xvfb + gnome-keyring, necessário para os cookies de sessão). O release também roda os unitários antes de gerar os instaladores.

## Regra: todo bug ganha um teste de regressão

Ao encontrar um bug:

1. Escrever primeiro o teste que **reproduz** o bug e ver ele **falhar**.
2. Corrigir o código e ver o teste passar.
3. Marcar o teste com um comentário `// Regressão: <o que acontecia>`, para ninguém removê-lo achando que é redundante.
4. Registrar a correção no `CHANGELOG.md` em "Corrigido".

Teste unitário quando a lógica dá para isolar; integração quando o bug depende do app real (cliques, foco, sessões, reinício).

## Unitários (`tests/unit`)

- O módulo `electron` é trocado por um stub (`tests/stubs/electron.ts`) — ver `vitest.config.ts`.
- Banco: `memoryStore()` em `tests/helpers.ts` cria um `Store` com SQLite em memória já migrado.
- Sessões do Electron (permissões, webRequest) são falsificadas capturando os handlers registrados.
- Código da UI que mexe no DOM usa `// @vitest-environment happy-dom` no topo do arquivo.
- Para algo ser testável sem Electron, a lógica pura fica em módulo próprio (ex.: `src/main/shortcuts.ts`, `src/shared/url.ts`, `src/renderer/reconcile.ts`).

## Integração (`tests/e2e`)

`tests/e2e/harness.ts`:

- `startSite()` — servidor HTTP local com páginas de teste (`/page?title=`, `/headers`, `/set-cookie?v=`, `/cookie`). Nada depende da internet.
- `Apollo.launch(perfil)` — abre o app num perfil temporário (`tempProfile()`), controlado via Chrome DevTools Protocol.
  - `app.send(cmd)` envia comandos como a UI enviaria; `app.state()` / `app.until(pred)` leem o estado.
  - `app.ui.mouseClick(seletor)` faz um clique real do mouse na interface.
  - `app.page(prefixoUrl)` conecta numa aba para executar JS dentro do site.
  - `app.quit()` fecha como o usuário fecharia (grava cookies e banco), para testar reinícios.
- Teclas injetadas via CDP **não** passam pelo `before-input-event` do Electron: atalhos são testados no unitário (`shortcutFor`) e a ação, pelo comando equivalente (`app.send`).

No Linux os testes de integração rodam **sem abrir janelas** (`--ozone-platform=headless`: o Chromium desenha em memória), então dá para continuar usando o computador enquanto rodam.

- `APOLLO_E2E_SHOW=1 npm run test:e2e` mostra as janelas (útil para depurar).
- `APOLLO_E2E_LOG=1 npm run test:e2e` mostra o log do Electron.

### Variáveis só para testes

Lidas pelo app apenas para tornar cenários de tempo determinísticos (sem efeito se ausentes):

| Variável | Efeito |
|---|---|
| `APOLLO_TEST_SESSION_RESTORE_DELAY_MS` | Atrasa a restauração dos cookies de sessão (simula chaveiro lento) |
| `APOLLO_TEST_MINUTE_MS` | Duração de um "minuto" da hibernação |
| `APOLLO_TEST_HIBERNATION_TICK_MS` | Intervalo da verificação de hibernação |

Passe com `Apollo.launch(perfil, { VAR: 'valor' })`.
